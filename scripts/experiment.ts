// QT experiment (simulation): does an inventory-aware house quoter lose less than a
// fixed-spread quoter as the share of informed order flow rises?
//
// Design
// - Seeded self-play hands (4 smart table bots). Deals, public event sequences, and every
//   random trader opportunity (arrive? informed or noise? which seat/contract/side?) are
//   pre-drawn per hand and shared by both policies and every informed share → paired.
// - Each policy runs its own Exchange (the production ledger + matching engine). The house
//   re-quotes after every public discard; one trader may arrive per discard and trades IOC
//   at the house quote, so each policy's quotes produce its own fills.
// - Informed trader: sees the private hand of one seat (drawn per opportunity) and uses the
//   fitted informed model; trades the single best edge if it beats the quote by > edge ticks.
//   Noise trader: trades a random contract/side regardless of price (liquidity need).
// - Markout reference = settlement value (100 or 0), horizon = end of hand, sign = from the
//   house's perspective (positive = house gained). Settled house P&L = sum of markouts.
// - Skew is tuned on tuning seeds at the tuning informed share; results use held-out seeds.
//
// Usage: npx tsx scripts/experiment.ts [configPath=experiments/config.json]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateHands, type HandRecord } from "../src/pricing/dataset";
import { outcomeProbabilities } from "../src/pricing/model";
import { informedDistribution } from "../src/pricing/informed";
import { quote, type QuoterParams } from "../src/pricing/quoter";
import { Exchange } from "../src/market/exchange";
import { CONTRACTS, contractForOutcome, PAYOUT, type ContractId, type Side } from "../src/market/types";
import { makeRng } from "../src/engine/rng";

interface Config {
  tuneHands: number;
  evalHands: number;
  tuneSeedPrefix: string;
  evalSeedPrefix: string;
  informedShares: number[];
  tuneInformedShare: number;
  arrivalProb: number;
  tradeSize: number;
  informedEdgeTicks: number;
  halfSpread: number;
  quoteSize: number;
  maxInventory: number;
  skewGrid: number[];
}

const configPath = process.argv[2] ?? "experiments/config.json";
const cfg: Config = JSON.parse(readFileSync(configPath, "utf8"));

interface Opportunity { arrive: number; type: number; seat: number; contract: number; side: number }

function opportunities(h: HandRecord): Opportunity[] {
  const rng = makeRng(`${h.seed}-arrivals`);
  return h.snapshots.map(() => ({ arrive: rng(), type: rng(), seat: rng(), contract: rng(), side: rng() }));
}

interface HandResult {
  housePnl: number;
  vsInformed: number;
  vsNoise: number;
  arrivals: number;
  informedArrivals: number;
  fills: number;
  informedFills: number;
  maxAbsInventory: number;
}

function simulateHand(h: HandRecord, opps: Opportunity[], params: QuoterParams, informedShare: number): HandResult {
  const ex = new Exchange(() => 0);
  ex.ensureAccount("house", "house", "house", 1e9);
  ex.ensureAccount("informed", "informed", "bot", 1e8);
  ex.ensureAccount("noise", "noise", "bot", 1e8);
  ex.openHand(h.seed);
  const r: HandResult = { housePnl: 0, vsInformed: 0, vsNoise: 0, arrivals: 0, informedArrivals: 0, fills: 0, informedFills: 0, maxAbsInventory: 0 };
  const houseTrades: { contract: ContractId; price: number; houseQty: number; who: "informed" | "noise" }[] = [];

  h.snapshots.forEach((snap, i) => {
    const probs = outcomeProbabilities(snap.pub);
    const house = ex.accounts.get("house")!;
    ex.cancelAll("house");
    const quotes = quote(probs, house.positions, params);
    for (const q of quotes) {
      if (q.bid !== null) ex.place({ accountId: "house", contract: q.contract, side: "buy", price: q.bid, qty: q.size, tif: "gtc" });
      if (q.ask !== null) ex.place({ accountId: "house", contract: q.contract, side: "sell", price: q.ask, qty: q.size, tif: "gtc" });
    }
    const o = opps[i];
    if (o.arrive >= cfg.arrivalProb) return;
    r.arrivals++;
    const informed = o.type < informedShare;
    let order: { contract: ContractId; side: Side; price: number } | null = null;
    if (informed) {
      r.informedArrivals++;
      const seat = Math.floor(o.seat * 4);
      const progress = 1 - Math.min(1, snap.pub.wallCount / 70);
      const dist = informedDistribution(probs, seat, snap.priv[seat], progress);
      let best = cfg.informedEdgeTicks;
      quotes.forEach((q, k) => {
        const fv = 100 * dist[k];
        if (q.ask !== null && fv - q.ask > best) {
          best = fv - q.ask;
          order = { contract: q.contract, side: "buy", price: q.ask };
        }
        if (q.bid !== null && q.bid - fv > best) {
          best = q.bid - fv;
          order = { contract: q.contract, side: "sell", price: q.bid };
        }
      });
    } else {
      const q = quotes[Math.floor(o.contract * 5)];
      const side: Side = o.side < 0.5 ? "buy" : "sell";
      const px = side === "buy" ? q.ask : q.bid;
      if (px !== null) order = { contract: q.contract, side, price: px };
    }
    if (!order) return;
    const who = informed ? "informed" : "noise";
    const o2 = order as { contract: ContractId; side: Side; price: number };
    const res = ex.place({ accountId: who, contract: o2.contract, side: o2.side, price: o2.price, qty: cfg.tradeSize, tif: "ioc" });
    if (!res.ok || res.fills.length === 0) return;
    r.fills++;
    if (informed) r.informedFills++;
    for (const f of res.fills) houseTrades.push({ contract: f.contract, price: f.price, houseQty: f.buyer === "house" ? f.qty : -f.qty, who });
    const inv = Math.max(...CONTRACTS.map((c) => Math.abs(ex.accounts.get("house")!.positions[c])));
    r.maxAbsInventory = Math.max(r.maxAbsInventory, inv);
  });

  const rec = ex.settle(h.seed, h.outcome);
  r.housePnl = rec.accounts.house?.pnl ?? 0;
  const winner = contractForOutcome(h.outcome);
  for (const t of houseTrades) {
    const markout = ((t.contract === winner ? PAYOUT : 0) - t.price) * t.houseQty;
    if (t.who === "informed") r.vsInformed += markout;
    else r.vsNoise += markout;
  }
  if (Math.abs(r.vsInformed + r.vsNoise - r.housePnl) > 1e-9) throw new Error("markout decomposition mismatch");
  return r;
}

function params(skew: number): QuoterParams {
  return { halfSpread: cfg.halfSpread, size: cfg.quoteSize, skewPerShare: skew, maxInventory: cfg.maxInventory };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};

function runPolicy(hands: HandRecord[], opps: Opportunity[][], p: QuoterParams, share: number) {
  return hands.map((h, i) => simulateHand(h, opps[i], p, share));
}

function summarize(rs: HandResult[]) {
  const sum = (k: keyof HandResult) => rs.reduce((a, r) => a + r[k], 0);
  return {
    housePnlPerHand: mean(rs.map((r) => r.housePnl)),
    housePnlSE: se(rs.map((r) => r.housePnl)),
    vsInformedPerHand: mean(rs.map((r) => r.vsInformed)),
    vsNoisePerHand: mean(rs.map((r) => r.vsNoise)),
    fillRate: sum("fills") / sum("arrivals"),
    informedFillRate: sum("informedArrivals") ? sum("informedFills") / sum("informedArrivals") : 0,
    fills: sum("fills"),
    meanMaxAbsInventory: mean(rs.map((r) => r.maxAbsInventory)),
  };
}

const t0 = Date.now();
console.log(`Generating ${cfg.tuneHands} tuning + ${cfg.evalHands} held-out hands (simulation)…`);
const tune = generateHands(cfg.tuneSeedPrefix, cfg.tuneHands);
const evalH = generateHands(cfg.evalSeedPrefix, cfg.evalHands);
const tuneOpps = tune.map(opportunities), evalOpps = evalH.map(opportunities);
console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// Tune the skew on tuning seeds only.
const tuning = cfg.skewGrid.map((skew) => ({ skew, ...summarize(runPolicy(tune, tuneOpps, params(skew), cfg.tuneInformedShare)) }));
const chosen = tuning.reduce((a, b) => (b.housePnlPerHand > a.housePnlPerHand ? b : a));
console.log("tuning (informed share", cfg.tuneInformedShare, "):");
console.table(tuning.map((t) => ({ skew: t.skew, pnlPerHand: t.housePnlPerHand.toFixed(1), se: t.housePnlSE.toFixed(1), fillRate: t.fillRate.toFixed(3) })));
console.log("chosen skew:", chosen.skew);

// Held-out comparison across informed shares, paired by hand.
const rows = cfg.informedShares.map((share) => {
  const fixed = runPolicy(evalH, evalOpps, params(0), share);
  const aware = runPolicy(evalH, evalOpps, params(chosen.skew), share);
  const diff = aware.map((r, i) => r.housePnl - fixed[i].housePnl);
  return { informedShare: share, fixed: summarize(fixed), aware: summarize(aware), pairedDiffPerHand: mean(diff), pairedDiffSE: se(diff) };
});

const f1 = (x: number) => x.toFixed(1);
const f3 = (x: number) => x.toFixed(3);
const table = rows
  .map(
    (r) =>
      `| ${r.informedShare} | ${f1(r.fixed.housePnlPerHand)} ± ${f1(r.fixed.housePnlSE)} | ${f1(r.aware.housePnlPerHand)} ± ${f1(r.aware.housePnlSE)} | ${f1(r.pairedDiffPerHand)} ± ${f1(r.pairedDiffSE)} | ${f3(r.fixed.fillRate)} / ${f3(r.aware.fillRate)} | ${f3(r.fixed.informedFillRate)} / ${f3(r.aware.informedFillRate)} | ${f1(r.fixed.vsInformedPerHand)} / ${f1(r.aware.vsInformedPerHand)} | ${f1(r.fixed.vsNoisePerHand)} / ${f1(r.aware.vsNoisePerHand)} | ${f1(r.fixed.meanMaxAbsInventory)} / ${f1(r.aware.meanMaxAbsInventory)} |`,
  )
  .join("\n");
console.table(rows.map((r) => ({ share: r.informedShare, fixed: f1(r.fixed.housePnlPerHand), aware: f1(r.aware.housePnlPerHand), diff: `${f1(r.pairedDiffPerHand)}±${f1(r.pairedDiffSE)}`, vsInfFixed: f1(r.fixed.vsInformedPerHand), vsInfAware: f1(r.aware.vsInformedPerHand) })));

mkdirSync("experiments", { recursive: true });
writeFileSync("experiments/results.json", JSON.stringify({ config: cfg, chosenSkew: chosen.skew, tuning, heldOut: rows }, null, 2) + "\n");
writeFileSync(
  "experiments/results-table.md",
  `<!-- generated by npm run experiment -->
Chosen skew (tuned on ${cfg.tuneHands} tuning hands at informed share ${cfg.tuneInformedShare}): **${chosen.skew} ticks per share**. Held-out: ${cfg.evalHands} hands.

| informed share | fixed P&L / hand | inventory-aware P&L / hand | paired diff (aware − fixed) | fill rate (fixed / aware) | informed fill rate | P&L vs informed | P&L vs noise | mean max abs inventory |
|---|---|---|---|---|---|---|---|---|
${table}

Tuning grid (informed share ${cfg.tuneInformedShare}, tuning seeds):

| skew | P&L / hand | SE | fill rate |
|---|---|---|---|
${tuning.map((t) => `| ${t.skew} | ${f1(t.housePnlPerHand)} | ${f1(t.housePnlSE)} | ${f3(t.fillRate)} |`).join("\n")}
`,
);
console.log(`wrote experiments/results.json and experiments/results-table.md (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
