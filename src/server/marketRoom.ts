// A Room with a market. All market mutations happen inside the room's synchronous
// command handlers, so they are serialized with table moves. The market settles in
// onHandEnded, which the base Room calls in the same call stack as the action that
// made the outcome final: no order can be accepted after the outcome is decided.

import { Room, type Participant, type RoomOptions } from "./room";
import { Exchange } from "../market/exchange";
import { CONTRACTS, STARTING_CREDITS, type ContractId, type Order, type PlaceResult, type Trade } from "../market/types";
import { outcomeProbabilities } from "../pricing/model";
import { HOUSE_DEFAULT, quote, type ContractQuote, type QuoterParams } from "../pricing/quoter";
import { outcomeOf } from "../engine/game";
import { publicView } from "../engine/views";
import type { HandState, PublicEvent } from "../engine/types";
import { kindLabel, kindOf, type Seat } from "../engine/tiles";
import { seatName, type ClientMessage, type OrderMessage, type YouView } from "../shared/protocol";
import type { ContractView, FairPoint, MarketMine, MarketShared, OrderView, TradeView } from "../shared/market";

export const HOUSE_ID = "house";
type CmdError = { code: string; message: string };
const HOUSE_BANKROLL = 1_000_000_000;

export class MarketRoom extends Room {
  readonly exchange = new Exchange();
  houseParams: QuoterParams = HOUSE_DEFAULT;
  private houseQuotes: ContractQuote[] = [];
  private houseProbs: number[] | null = null;
  private fairSeries: FairPoint[] = [];
  private explanation: string | null = null;
  private repricePending = false;
  private lastPricedVersion = -1;
  private pendingLabel = "";
  private lastSettlementHand: string | null = null;
  private sharedCache: string | null = null;
  private recentClosed = new Map<string, Order[]>();
  /** Model calls that exceeded the budget (diagnostic; see repriceHouse). */
  slowPricings = 0;

  constructor(opts: RoomOptions) {
    super(opts);
    if (this.mode === "house") this.exchange.ensureAccount(HOUSE_ID, "The House", "house", HOUSE_BANKROLL);
  }

  override addParticipant(name: string): Participant {
    const p = super.addParticipant(name);
    this.exchange.ensureAccount(p.id, p.name, "human");
    return p;
  }

  // ------------------------------------------------------------ lifecycle hooks

  protected override onHandStarted(hand: HandState): void {
    this.exchange.openHand(hand.handId);
    this.fairSeries = [];
    this.explanation = null;
    this.lastPricedVersion = -1;
    this.recentClosed.clear();
    if (this.mode === "house") {
      this.pendingLabel = "Hand dealt";
      this.repriceHouse(hand.version); // opening quotes are synchronous so the book is never empty
    }
    this.pushFeed("market", `Market open for hand ${hand.config.handNumber}: 5 contracts (4 seats + draw), each pays 100 if it wins`);
  }

  protected override onTableChanged(hand: HandState, events: PublicEvent[]): void {
    if (this.mode !== "house") return;
    const label = this.describeEvents(events);
    if (label) this.pendingLabel = label;
    this.scheduleReprice(hand.version);
  }

  protected override onHandEnded(hand: HandState): void {
    const outcome = outcomeOf(hand)!;
    const rec = this.exchange.settle(hand.handId, outcome);
    this.lastSettlementHand = hand.handId;
    this.houseQuotes = [];
    const label = outcome === "draw" ? "DRAW" : `${seatName(outcome)}`;
    this.pushFeed("market", `Market closed and settled: ${label} pays 100 per share; all other contracts expire at 0`);
    for (const p of this.allParticipants()) {
      const r = rec.accounts[p.id];
      if (r) this.notifyParticipant(p.id, `Hand settled: ${label} won. Payout ${r.payout >= 0 ? "+" : ""}${r.payout}, hand P&L ${r.pnl >= 0 ? "+" : ""}${r.pnl} credits.`);
    }
  }

  // ------------------------------------------------------------ house pricing

  private scheduleReprice(version: number): void {
    if (this.repricePending) return;
    this.repricePending = true;
    // Deferred so table broadcasts are never blocked by pricing; a result computed for
    // an older table version is discarded and a fresh one is scheduled.
    setImmediate(() => {
      this.repricePending = false;
      const hand = this.hand;
      if (!hand || this.exchange.status !== "open" || hand.handId !== this.exchange.handId) return;
      this.repriceHouse(version);
      if (hand.version !== version) this.scheduleReprice(hand.version);
    });
  }

  private repriceHouse(version: number): void {
    const hand = this.hand;
    if (!hand || version === this.lastPricedVersion) return;
    const started = performance.now();
    const probs = outcomeProbabilities(publicView(hand));
    if (performance.now() - started > 50) this.slowPricings++;
    if (hand.version !== version) return; // stale: table moved on while pricing
    this.lastPricedVersion = version;
    const prev = this.houseProbs;
    this.houseProbs = probs;
    const label = this.pendingLabel || "Wall progressed";
    this.pendingLabel = "";
    if (!prev || probs.some((p, i) => Math.abs(p - prev[i]) > 0.002)) {
      this.fairSeries.push({ version, at: Date.now(), label, probs: probs.map((p) => Math.round(p * 1000) / 1000) });
      if (this.fairSeries.length > 200) this.fairSeries.shift();
      this.explanation = prev ? explainMove(label, prev, probs) : `Opening prices from the public model: ${probs.map((p, i) => `${contractShort(i)} ${Math.round(100 * p)}`).join(", ")}.`;
    }
    this.requoteHouse();
    this.markDirty();
  }

  private requoteHouse(): void {
    if (!this.houseProbs || this.exchange.status !== "open") return;
    const house = this.exchange.accounts.get(HOUSE_ID)!;
    this.exchange.cancelAll(HOUSE_ID, "requote");
    this.houseQuotes = quote(this.houseProbs, house.positions, this.houseParams);
    for (const q of this.houseQuotes) {
      if (q.bid !== null) this.exchange.place({ accountId: HOUSE_ID, contract: q.contract, side: "buy", price: q.bid, qty: q.size, tif: "gtc" });
      if (q.ask !== null) this.exchange.place({ accountId: HOUSE_ID, contract: q.contract, side: "sell", price: q.ask, qty: q.size, tif: "gtc" });
    }
  }

  private describeEvents(events: PublicEvent[]): string {
    let label = "";
    for (const e of events) {
      if (e.type === "discard") label = e.riichi ? `${this.seatLabel(e.seat)} declared riichi` : `${this.seatLabel(e.seat)} discarded ${kindLabel(kindOf(e.tile))}`;
      else if (e.type === "call") label = `${this.seatLabel(e.seat)} called ${e.meld.type}`;
      else if (e.type === "dora") label = "New kan dora revealed";
      else if (e.type === "draw" && !label) label = `${this.seatLabel(e.seat)} drew (wall shrinks)`;
    }
    return label;
  }

  // ------------------------------------------------------------ commands

  protected override dispatch(p: Participant, msg: ClientMessage) {
    switch (msg.t) {
      case "order":
        return this.handleOrder(p, msg);
      case "cancel": {
        const r = this.exchange.cancel(p.id, msg.orderId);
        if (!r.ok) return { code: r.code, message: r.message };
        this.rememberClosed(p.id, [r.order]);
        this.markDirty();
        return null;
      }
      case "cancelAll": {
        const closed = this.exchange.cancelAll(p.id);
        this.rememberClosed(p.id, closed);
        this.markDirty();
        return null;
      }
      default:
        return super.dispatch(p, msg);
    }
  }

  tradeBlockReason(p: Participant): string | null {
    if (this.exchange.status !== "open" || this.phase !== "playing") return "The market opens when a hand is dealt.";
    if (this.seatOf(p.id) !== null && !this.settings.seatedCanTrade) return "The host has disabled trading for seated players in this room.";
    return null;
  }

  /** Shared order path for humans and trading bots (same execution and collateral rules). */
  submitOrder(accountId: string, msg: OrderMessage): CmdError | { ok: true; result: PlaceResult; before: ContractQuote | undefined } {
    if (!this.hand || msg.handId !== this.hand.handId) return { code: "stale_hand", message: "That order was for a previous hand. The market has been refreshed." };
    const before = this.mode === "house" ? this.houseQuotes.find((q) => q.contract === msg.contract) : undefined;
    const r = this.exchange.place({ accountId, contract: msg.contract, side: msg.side, price: msg.price, qty: msg.qty, tif: msg.tif });
    if (!r.ok) return { code: r.code, message: r.message };
    this.rememberClosed(accountId, [...r.stpCancelled, ...(r.order.status !== "open" ? [r.order] : [])]);
    for (const t of r.fills) this.feedTrade(t);
    if (this.mode === "house" && r.fills.length > 0) this.requoteHouse();
    this.markDirty();
    return { ok: true, result: r, before };
  }

  private handleOrder(p: Participant, msg: OrderMessage): CmdError | null {
    const blocked = this.tradeBlockReason(p);
    if (blocked) return { code: "trade_blocked", message: blocked };
    if (this.mode === "house" && msg.tif !== "ioc") {
      return { code: "house_ioc_only", message: "In Trade Against the House you trade at the house's quote; resting orders are only available in Open Exchange." };
    }
    const out = this.submitOrder(p.id, msg);
    if (!("ok" in out)) return out;
    const { result: r, before } = out;
    const label = contractLabel(msg.contract);
    const filled = r.fills.reduce((s, f) => s + f.qty, 0);
    const avgPx = filled ? r.fills.reduce((s, f) => s + f.qty * f.price, 0) / filled : 0;
    const verb = msg.side === "buy" ? "Bought" : "Sold";
    if (r.stpCancelled.length) this.notifyParticipant(p.id, `Self-trade prevented: your resting ${r.stpCancelled.map((o) => `${o.side} ${o.qty} @ ${o.price}`).join(", ")} was cancelled.`);
    if (this.mode === "house" && filled === 0) {
      const now = this.houseQuotes.find((q) => q.contract === msg.contract);
      const side = msg.side === "buy" ? "ask" : "bid";
      const px = now ? (msg.side === "buy" ? now.ask : now.bid) : null;
      const was = before ? (msg.side === "buy" ? before.ask : before.bid) : null;
      return {
        code: "quote_moved",
        message:
          px === null
            ? `The house is not quoting a ${side} on ${label} right now. Nothing traded.`
            : `The house ${side} on ${label} is ${px} (you clicked ${msg.price}${was !== null && was !== px ? `; it moved from ${was}` : ""}). Nothing traded — check the new price and click again.`,
      };
    }
    const summary =
      r.status === "filled"
        ? `${verb} ${filled} ${label} @ ${fmtPx(avgPx)} — filled.`
        : r.status === "partial-resting"
          ? `${verb} ${filled} ${label} @ ${fmtPx(avgPx)}; ${r.order.qty} still resting at ${msg.price}.`
          : r.status === "partial-cancelled"
            ? `${verb} ${filled} ${label} @ ${fmtPx(avgPx)}; the unfilled ${r.order.qty} was cancelled (IOC).`
            : r.status === "resting"
              ? `Order resting: ${msg.side} ${msg.qty} ${label} @ ${msg.price}.`
              : `Nothing traded on ${label} at ${msg.price}; the IOC order was cancelled.`;
    this.notifyParticipant(p.id, summary);
    for (const f of r.fills) {
      const maker = msg.side === "buy" ? f.seller : f.buyer;
      if (maker !== p.id && maker !== HOUSE_ID) this.notifyParticipant(maker, `Your resting ${msg.side === "buy" ? "sell" : "buy"} on ${label} filled: ${f.qty} @ ${f.price}.`);
    }
    return null;
  }

  private rememberClosed(accountId: string, orders: Order[]): void {
    if (!orders.length) return;
    const list = this.recentClosed.get(accountId) ?? [];
    list.push(...orders.map((o) => ({ ...o })));
    this.recentClosed.set(accountId, list.slice(-12));
  }

  protected feedTrade(t: Trade): void {
    const name = (id: string) => (id === HOUSE_ID ? "the House" : (this.exchange.accounts.get(id)?.name ?? "?"));
    this.pushFeed("market", `Trade: ${name(t.buyer)} bought ${t.qty} ${contractLabel(t.contract)} @ ${t.price} from ${name(t.seller)}`);
  }

  // ------------------------------------------------------------ views

  protected override youView(p: Participant): YouView {
    const reason = this.tradeBlockReason(p);
    return { ...super.youView(p), canTrade: reason === null, tradeBlockedReason: reason };
  }

  override flush(): void {
    this.sharedCache = null;
    super.flush();
  }

  /** Extra shared fields contributed by subclasses (trading bots). */
  protected botViews(): Pick<MarketShared, "bots" | "botSetupNote"> {
    return { bots: [], botSetupNote: null };
  }

  sharedView(): MarketShared {
    const ex = this.exchange;
    const contracts: ContractView[] = CONTRACTS.map((c, i) => {
      const d = ex.depth(c);
      const trades = ex.trades.filter((t) => t.contract === c);
      const q = this.houseQuotes.find((x) => x.contract === c);
      const best = ex.best(c);
      return {
        id: c,
        label: this.contractName(i),
        bids: d.bids,
        asks: d.asks,
        last: trades.length ? trades[trades.length - 1].price : null,
        volume: trades.reduce((s, t) => s + t.qty, 0),
        house:
          this.mode === "house" && q
            ? {
                bid: best.bid?.accountId === HOUSE_ID ? best.bid.price : null,
                ask: best.ask?.accountId === HOUSE_ID ? best.ask.price : null,
                bidSize: best.bid?.accountId === HOUSE_ID ? best.bid.qty : 0,
                askSize: best.ask?.accountId === HOUSE_ID ? best.ask.qty : 0,
                fair: Math.round(q.fair * 10) / 10,
              }
            : undefined,
      };
    });
    const name = (id: string) => (id === HOUSE_ID ? "House" : (ex.accounts.get(id)?.name ?? "?"));
    const tape: TradeView[] = ex.trades.slice(-30).reverse().map((t) => ({ id: t.id, contract: t.contract, price: t.price, qty: t.qty, at: t.at, aggressor: t.aggressor, buyer: name(t.buyer), seller: name(t.seller) }));
    const house = ex.accounts.get(HOUSE_ID);
    const rec = this.lastSettlementHand ? ex.settlements.get(this.lastSettlementHand) : undefined;
    return {
      mode: this.mode,
      status: ex.status,
      handId: ex.handId,
      contracts,
      tape,
      fairSeries: this.fairSeries,
      explanation: this.explanation,
      leaderboard: [...ex.accounts.values()]
        .filter((a) => a.kind !== "house")
        .map((a) => ({ name: a.name, kind: a.kind, settledPnl: a.settledPnl, cash: a.cash }))
        .sort((a, b) => b.settledPnl - a.settledPnl)
        .slice(0, 20),
      house: house
        ? { inventory: { ...house.positions }, halfSpread: this.houseParams.halfSpread, skewPerShare: this.houseParams.skewPerShare, size: this.houseParams.size, settledPnl: house.settledPnl }
        : null,
      ...this.botViews(),
      lastSettlement: rec ? { handId: rec.handId, outcome: rec.outcome, winningContract: rec.winningContract } : null,
    };
  }

  mineView(accountId: string): MarketMine | null {
    const ex = this.exchange;
    const a = ex.accounts.get(accountId);
    if (!a) return null;
    const toView = (o: Order): OrderView => ({ id: o.id, contract: o.contract, side: o.side, price: o.price, qty: o.qty, origQty: o.origQty, filledQty: o.filledQty, tif: o.tif, status: o.status, cancelReason: o.cancelReason, createdAt: o.createdAt });
    const name = (id: string) => (id === HOUSE_ID ? "House" : (ex.accounts.get(id)?.name ?? "?"));
    const rec = this.lastSettlementHand ? ex.settlements.get(this.lastSettlementHand) : undefined;
    const mineRec = rec?.accounts[accountId];
    return {
      account: {
        cash: a.cash,
        available: ex.available(accountId),
        reserved: ex.reserved(accountId),
        shortLock: ex.shortLock(a),
        positions: { ...a.positions },
        settledPnl: a.settledPnl,
        handCashFlow: a.cash - a.handStartCash,
        startingCredits: STARTING_CREDITS,
      },
      openOrders: ex.openOrdersOf(accountId).map(toView),
      recentOrders: (this.recentClosed.get(accountId) ?? []).slice().reverse().map(toView),
      fills: ex.trades
        .filter((t) => t.buyer === accountId || t.seller === accountId)
        .slice(-20)
        .reverse()
        .map((t) => ({ id: t.id, contract: t.contract, price: t.price, qty: t.qty, at: t.at, aggressor: t.aggressor, buyer: name(t.buyer), seller: name(t.seller), side: t.buyer === accountId ? "buy" : "sell" })),
      settlement: rec && mineRec ? { handId: rec.handId, winningContract: rec.winningContract, positions: mineRec.positions, payout: mineRec.payout, pnl: mineRec.pnl } : null,
    };
  }

  protected override extraState(p: Participant): string {
    if (this.sharedCache === null) this.sharedCache = JSON.stringify(this.sharedView());
    return `,"market":{"shared":${this.sharedCache},"mine":${JSON.stringify(this.mineView(p.id))}}`;
  }

  contractName(i: number): string {
    if (i === 4) return "Draw";
    const occ = this.occupant(i as Seat);
    const who = !occ ? "" : occ.kind === "bot" ? ` · ${occ.name}` : ` · ${this.participantName(occ.participantId)}`;
    return `${seatName(i)}${who}`;
  }
}

const contractShort = (i: number) => (i === 4 ? "Draw" : seatName(i));
export const contractLabel = (c: ContractId) => contractShort(CONTRACTS.indexOf(c));
const fmtPx = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** Human-readable reason for a fair-value move: the event plus the biggest movers. */
export function explainMove(label: string, prev: number[], next: number[]): string {
  const moves = next.map((p, i) => ({ i, d: p - prev[i], p })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const top = moves.filter((m) => Math.abs(m.d) >= 0.005).slice(0, 2);
  if (!top.length) return `${label}: fair values essentially unchanged.`;
  return `${label}: ${top.map((m) => `${contractShort(m.i)} ${m.d > 0 ? "▲" : "▼"} ${Math.round(100 * (m.p - m.d))}→${Math.round(100 * m.p)}`).join(", ")}.`;
}
