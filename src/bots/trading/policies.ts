// Trading bot policies for Open Exchange. Pure decision functions: they receive a
// snapshot and return actions; the room executes them through the same order path
// and collateral rules as humans. Each kind uses different inputs:
//
//   informed — public view + the private hand of ONE bot-controlled seat (never a human's)
//   public   — public view only (the same public model the house uses)
//   noise    — no hand information: scheduled liquidity needs + inventory reduction
//   random   — seeded uniform choice among bounded actions (baseline)

import type { Rng } from "../../engine/rng";
import { randInt } from "../../engine/rng";
import { CONTRACTS, type ContractId, type Side } from "../../market/types";
import type { PrivateSeatFeatures } from "../../pricing/dataset";
import { informedDistribution } from "../../pricing/informed";

export type TradingBotKind = "informed" | "public" | "noise" | "random";

export interface BookTop {
  bid: number | null;
  bidQty: number;
  ask: number | null;
  askQty: number;
}

export interface BotSnapshot {
  /** Public-model probabilities for the five outcomes (from public information only). */
  publicProbs: number[];
  progress: number; // 0 at the deal → 1 when the wall is empty
  book: Record<ContractId, BookTop>;
  /** Best prices excluding this bot's own orders (what it could actually trade against). */
  bookExOwn: Record<ContractId, BookTop>;
  positions: Record<ContractId, number>;
  available: number;
  openOrderCount: number;
  /** Informed bots only: features of the attached seat's hand. */
  privateSeat?: { seat: number; features: PrivateSeatFeatures };
}

export type BotAction =
  | { type: "order"; contract: ContractId; side: Side; price: number; qty: number; tif: "gtc" | "ioc"; reason: string }
  | { type: "cancelAll" };

const clampPx = (p: number) => Math.max(1, Math.min(99, Math.round(p)));

/** Shared helper: take mispriced quotes beyond `edge`, then (optionally) quote around fair. */
function valueTrader(fair: number[], s: BotSnapshot, edge: number, quoteHalf: number | null, size: number, label: string): BotAction[] {
  const out: BotAction[] = [{ type: "cancelAll" }];
  CONTRACTS.forEach((c, i) => {
    const fv = 100 * fair[i];
    const top = s.bookExOwn[c];
    const pos = s.positions[c];
    if (top.ask !== null && top.ask <= fv - edge && pos < 60) {
      out.push({ type: "order", contract: c, side: "buy", price: top.ask, qty: Math.min(size, top.askQty), tif: "ioc", reason: `${label}: ask ${top.ask} < fair ${fv.toFixed(1)} − ${edge}` });
    } else if (top.bid !== null && top.bid >= fv + edge && pos > -60) {
      out.push({ type: "order", contract: c, side: "sell", price: top.bid, qty: Math.min(size, top.bidQty), tif: "ioc", reason: `${label}: bid ${top.bid} > fair ${fv.toFixed(1)} + ${edge}` });
    }
    if (quoteHalf !== null) {
      const skew = pos * 0.05; // lean against own inventory
      const bid = clampPx(Math.floor(fv - quoteHalf - skew));
      const ask = clampPx(Math.ceil(fv + quoteHalf - skew));
      if (bid < ask) {
        if (pos < 60 && bid >= 1) out.push({ type: "order", contract: c, side: "buy", price: bid, qty: size, tif: "gtc", reason: `${label} quote` });
        if (pos > -60 && ask <= 99) out.push({ type: "order", contract: c, side: "sell", price: ask, qty: size, tif: "gtc", reason: `${label} quote` });
      }
    }
  });
  return out;
}

export function informedPolicy(s: BotSnapshot): BotAction[] {
  if (!s.privateSeat) return [];
  const fair = informedDistribution(s.publicProbs, s.privateSeat.seat, s.privateSeat.features, s.progress);
  // Takes when its private edge beats the price by 3+ ticks; quotes wide (±6) otherwise.
  return valueTrader(fair, s, 3, 6, 8, "informed");
}

export function publicPolicy(s: BotSnapshot): BotAction[] {
  // Quotes ±4 around the public fair value and takes only clearly favourable prices (6+ ticks).
  return valueTrader(s.publicProbs, s, 6, 4, 10, "public");
}

export interface NoiseState {
  nextNeedAt: number; // decision count at which the next liquidity need fires
  decisions: number;
}

/**
 * Noise: trades for reasons unrelated to the hand. (1) Scheduled liquidity needs:
 * every few decisions it must buy or sell a block of a randomly chosen contract and
 * pays up to 5 ticks through the touch to get it done. (2) Inventory control: when
 * any position exceeds 25 shares it works it back toward zero at the touch.
 */
export function noisePolicy(s: BotSnapshot, st: NoiseState, rng: Rng): BotAction[] {
  st.decisions++;
  const out: BotAction[] = [];
  for (const c of CONTRACTS) {
    const pos = s.positions[c];
    const top = s.bookExOwn[c];
    if (pos > 25 && top.bid !== null) out.push({ type: "order", contract: c, side: "sell", price: top.bid, qty: Math.min(pos - 15, top.bidQty), tif: "ioc", reason: "noise: reduce inventory" });
    if (pos < -25 && top.ask !== null) out.push({ type: "order", contract: c, side: "buy", price: top.ask, qty: Math.min(-pos - 15, top.askQty), tif: "ioc", reason: "noise: reduce inventory" });
  }
  if (st.decisions >= st.nextNeedAt) {
    st.nextNeedAt = st.decisions + 2 + randInt(rng, 4);
    const c = CONTRACTS[randInt(rng, CONTRACTS.length)];
    const side: Side = rng() < 0.5 ? "buy" : "sell";
    const top = s.bookExOwn[c];
    const qty = 3 + randInt(rng, 8);
    if (side === "buy" && top.ask !== null) out.push({ type: "order", contract: c, side, price: clampPx(top.ask + 5), qty, tif: "ioc", reason: "noise: scheduled liquidity need" });
    if (side === "sell" && top.bid !== null) out.push({ type: "order", contract: c, side, price: clampPx(top.bid - 5), qty, tif: "ioc", reason: "noise: scheduled liquidity need" });
    // Empty book: post a resting order near the public prior so a need can be met later.
    if ((side === "buy" ? top.ask : top.bid) === null) {
      const fv = 100 * s.publicProbs[CONTRACTS.indexOf(c)];
      out.push({ type: "order", contract: c, side, price: clampPx(side === "buy" ? fv - 2 : fv + 2), qty, tif: "gtc", reason: "noise: resting liquidity need" });
    }
  }
  return out;
}

/** Random baseline: one bounded action chosen uniformly by a seeded RNG. */
export function randomPolicy(s: BotSnapshot, rng: Rng): BotAction[] {
  const roll = randInt(rng, 4);
  const c = CONTRACTS[randInt(rng, CONTRACTS.length)];
  const side: Side = rng() < 0.5 ? "buy" : "sell";
  if (roll === 0 && s.openOrderCount > 0) return [{ type: "cancelAll" }];
  if (roll === 1) {
    const top = s.bookExOwn[c];
    const px = side === "buy" ? top.ask : top.bid;
    if (px !== null) return [{ type: "order", contract: c, side, price: px, qty: 1 + randInt(rng, 5), tif: "ioc", reason: "random: take" }];
  }
  if (s.openOrderCount >= 6) return [];
  return [{ type: "order", contract: c, side, price: 1 + randInt(rng, 99), qty: 1 + randInt(rng, 10), tif: "gtc", reason: "random: post" }];
}

export const BOT_DESCRIPTIONS: Record<TradingBotKind, string> = {
  informed: "Reads the private hand of one bot-controlled seat plus the public table; trades when its edge beats the price.",
  public: "Uses only public information (the house's public model); quotes around fair value and takes clear mispricings.",
  noise: "Ignores the hand: trades on scheduled liquidity needs and to reduce inventory.",
  random: "Seeded random baseline: posts, takes, or cancels at random within bounds.",
};
