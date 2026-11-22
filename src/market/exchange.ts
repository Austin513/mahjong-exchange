// Ledger + matching engine for one room. Pure and synchronous: no I/O, no timers.
// The room calls it from its serialized command path, so an order, a cancel, and
// settlement can never interleave.
//
// Collateral model (fully collateralised, conservative):
//   available = cash − 100·Σ max(0, −position) − Σ open-order reservedCash
//   buy  order reserves qty × limit
//   sell order: shares covered by an uncommitted long reserve those shares; the
//               uncovered remainder reserves (100 − limit) per share
//   fills release reservation at the limit and book cash at the resting price,
//   so `available` never drops below zero (proof sketch in docs/PLAN.md).

import {
  CONTRACTS,
  PAYOUT,
  STARTING_CREDITS,
  contractForOutcome,
  emptyPositions,
  type Account,
  type AccountKind,
  type ContractId,
  type Order,
  type PlaceError,
  type PlaceResult,
  type SettlementRecord,
  type Side,
  type TimeInForce,
  type Trade,
} from "./types";
import type { Outcome } from "../engine/types";

export interface PlaceInput {
  accountId: string;
  contract: ContractId;
  side: Side;
  price: number;
  qty: number;
  tif: TimeInForce;
}

const err = (code: string, message: string): PlaceError => ({ ok: false, code, message });

export class Exchange {
  readonly accounts = new Map<string, Account>();
  readonly orders = new Map<string, Order>();
  /** Resting orders per contract and side, best first (price, then time). */
  private bids: Record<ContractId, Order[]> = { SEAT_0: [], SEAT_1: [], SEAT_2: [], SEAT_3: [], DRAW: [] };
  private asks: Record<ContractId, Order[]> = { SEAT_0: [], SEAT_1: [], SEAT_2: [], SEAT_3: [], DRAW: [] };
  trades: Trade[] = [];
  handId: string | null = null;
  status: "idle" | "open" | "closed" = "idle";
  readonly settlements = new Map<string, SettlementRecord>();
  private seq = 0;

  constructor(private now: () => number = Date.now) {}

  // ------------------------------------------------------------ accounts

  ensureAccount(id: string, name: string, kind: AccountKind, cash = STARTING_CREDITS): Account {
    let a = this.accounts.get(id);
    if (!a) {
      a = { id, name, kind, cash, positions: emptyPositions(), handStartCash: cash, settledPnl: 0 };
      this.accounts.set(id, a);
    }
    return a;
  }

  shortLock(a: Account): number {
    let s = 0;
    for (const c of CONTRACTS) if (a.positions[c] < 0) s += -a.positions[c] * PAYOUT;
    return s;
  }

  reserved(accountId: string): number {
    let r = 0;
    for (const o of this.openOrdersOf(accountId)) r += o.reservedCash;
    return r;
  }

  available(accountId: string): number {
    const a = this.accounts.get(accountId);
    if (!a) return 0;
    return a.cash - this.shortLock(a) - this.reserved(accountId);
  }

  openOrdersOf(accountId: string): Order[] {
    const out: Order[] = [];
    for (const c of CONTRACTS) {
      for (const o of this.bids[c]) if (o.accountId === accountId) out.push(o);
      for (const o of this.asks[c]) if (o.accountId === accountId) out.push(o);
    }
    return out.sort((x, y) => x.seq - y.seq);
  }

  /** Long shares already promised to this account's open sell orders. */
  private committedLong(accountId: string, contract: ContractId): number {
    let n = 0;
    for (const o of this.asks[contract]) if (o.accountId === accountId) n += o.coveredRemaining;
    return n;
  }

  // ------------------------------------------------------------ hand lifecycle

  openHand(handId: string): void {
    if (this.status === "open") throw new Error("previous hand not settled");
    this.handId = handId;
    this.status = "open";
    this.trades = [];
    for (const a of this.accounts.values()) a.handStartCash = a.cash;
  }

  // ------------------------------------------------------------ orders

  /** Reservation an order would need right now, or an error if it cannot be funded. */
  quoteReservation(input: PlaceInput): { reservedCash: number; covered: number } {
    const a = this.accounts.get(input.accountId)!;
    if (input.side === "buy") return { reservedCash: input.qty * input.price, covered: 0 };
    const freeLong = Math.max(0, a.positions[input.contract] - this.committedLong(a.id, input.contract));
    const covered = Math.min(input.qty, freeLong);
    return { reservedCash: (input.qty - covered) * (PAYOUT - input.price), covered };
  }

  place(input: PlaceInput): PlaceResult | PlaceError {
    if (this.status !== "open") return err("market_closed", "The market is closed — trading reopens when the next hand is dealt.");
    const a = this.accounts.get(input.accountId);
    if (!a) return err("no_account", "No trading account.");
    if (!CONTRACTS.includes(input.contract)) return err("bad_contract", "Unknown contract.");
    if (!Number.isInteger(input.price) || input.price < 1 || input.price >= PAYOUT) return err("bad_price", "Price must be a whole number from 1 to 99.");
    if (!Number.isInteger(input.qty) || input.qty < 1) return err("bad_qty", "Quantity must be a whole number of shares.");

    const { reservedCash, covered } = this.quoteReservation(input);
    const avail = this.available(a.id);
    if (reservedCash > avail) {
      return err(
        "insufficient_funds",
        `Not enough available credits: this order needs ${reservedCash} but you have ${avail} available. Reduce the size, or cancel open orders to free reservations.`,
      );
    }

    const order: Order = {
      id: `o${++this.seq}`,
      accountId: a.id,
      contract: input.contract,
      side: input.side,
      price: input.price,
      qty: input.qty,
      origQty: input.qty,
      filledQty: 0,
      tif: input.tif,
      seq: this.seq,
      createdAt: this.now(),
      reservedCash,
      coveredRemaining: covered,
      status: "open",
    };
    this.orders.set(order.id, order);

    const fills: Trade[] = [];
    const stpCancelled: Order[] = [];
    const opposite = order.side === "buy" ? this.asks[order.contract] : this.bids[order.contract];
    while (order.qty > 0 && opposite.length > 0) {
      const best = opposite[0];
      const crosses = order.side === "buy" ? best.price <= order.price : best.price >= order.price;
      if (!crosses) break;
      if (best.accountId === order.accountId) {
        // Self-trade prevention: cancel the resting order (expire maker), keep matching.
        opposite.shift();
        this.closeOrder(best, "stp");
        stpCancelled.push(best);
        continue;
      }
      const qty = Math.min(order.qty, best.qty);
      fills.push(this.fill(order, best, qty));
      if (best.qty === 0) {
        opposite.shift();
        best.status = "filled";
      }
    }

    let status: PlaceResult["status"];
    if (order.qty === 0) {
      order.status = "filled";
      status = "filled";
    } else if (order.tif === "ioc") {
      this.closeOrder(order, "ioc");
      status = order.filledQty > 0 ? "partial-cancelled" : "cancelled";
    } else {
      this.rest(order);
      status = order.filledQty > 0 ? "partial-resting" : "resting";
    }
    return { ok: true, order: { ...order }, fills, stpCancelled, status };
  }

  private rest(o: Order): void {
    const book = o.side === "buy" ? this.bids[o.contract] : this.asks[o.contract];
    const better = (x: Order) => (o.side === "buy" ? x.price >= o.price : x.price <= o.price);
    let i = 0;
    while (i < book.length && better(book[i])) i++; // equal price: after existing (time priority)
    book.splice(i, 0, o);
  }

  /** Execute `qty` between an incoming order and a resting order at the resting price. */
  private fill(incoming: Order, resting: Order, qty: number): Trade {
    const price = resting.price;
    const buyO = incoming.side === "buy" ? incoming : resting;
    const sellO = incoming.side === "buy" ? resting : incoming;
    const buyer = this.accounts.get(buyO.accountId)!;
    const seller = this.accounts.get(sellO.accountId)!;
    const c = incoming.contract;

    // Release reservations at each order's own limit, then book at the trade price.
    buyO.reservedCash -= qty * buyO.price;
    const coveredFill = Math.min(qty, sellO.coveredRemaining);
    sellO.coveredRemaining -= coveredFill;
    sellO.reservedCash -= (qty - coveredFill) * (PAYOUT - sellO.price);

    buyer.cash -= qty * price;
    buyer.positions[c] += qty;
    seller.cash += qty * price;
    seller.positions[c] -= qty;

    for (const o of [buyO, sellO]) {
      o.qty -= qty;
      o.filledQty += qty;
    }
    const t: Trade = {
      id: `t${++this.seq}`,
      contract: c,
      price,
      qty,
      buyer: buyer.id,
      seller: seller.id,
      buyOrderId: buyO.id,
      sellOrderId: sellO.id,
      aggressor: incoming.side,
      at: this.now(),
      seq: this.seq,
    };
    this.trades.push(t);
    return t;
  }

  private closeOrder(o: Order, reason: NonNullable<Order["cancelReason"]>): void {
    o.status = "cancelled";
    o.cancelReason = reason;
    o.reservedCash = 0;
    o.coveredRemaining = 0;
  }

  cancel(accountId: string, orderId: string): { ok: true; order: Order } | PlaceError {
    const o = this.orders.get(orderId);
    if (!o || o.accountId !== accountId) return err("no_order", "That order was not found.");
    if (o.status !== "open") return err("not_open", `That order is already ${o.status}.`);
    const book = o.side === "buy" ? this.bids[o.contract] : this.asks[o.contract];
    book.splice(book.indexOf(o), 1);
    this.closeOrder(o, "user");
    return { ok: true, order: { ...o } };
  }

  cancelAll(accountId: string, reason: NonNullable<Order["cancelReason"]> = "user"): Order[] {
    const out: Order[] = [];
    for (const c of CONTRACTS) {
      for (const book of [this.bids[c], this.asks[c]]) {
        for (let i = book.length - 1; i >= 0; i--) {
          if (book[i].accountId !== accountId) continue;
          const [o] = book.splice(i, 1);
          this.closeOrder(o, reason);
          out.push(o);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ settlement

  /**
   * Close the market and pay the winning contract. Idempotent per handId: a retry
   * returns the original record and changes nothing.
   */
  settle(handId: string, outcome: Outcome): SettlementRecord {
    const prior = this.settlements.get(handId);
    if (prior) return prior;
    if (this.handId !== handId) throw new Error(`settle(${handId}) but open hand is ${this.handId}`);
    // 1) cancel every open order (releases all reservations)
    for (const c of CONTRACTS) {
      for (const book of [this.bids[c], this.asks[c]]) {
        for (const o of book) this.closeOrder(o, "settlement");
        book.length = 0;
      }
    }
    // 2) pay the winner, zero positions, roll P&L
    const winning = contractForOutcome(outcome);
    const accounts: SettlementRecord["accounts"] = {};
    for (const a of this.accounts.values()) {
      const positions = { ...a.positions };
      const payout = positions[winning] * PAYOUT;
      a.cash += payout;
      const pnl = a.cash - a.handStartCash;
      a.settledPnl += pnl;
      a.positions = emptyPositions();
      a.handStartCash = a.cash;
      if (CONTRACTS.some((c) => positions[c] !== 0) || pnl !== 0) accounts[a.id] = { accountId: a.id, positions, payout, pnl };
    }
    this.status = "closed";
    const rec: SettlementRecord = { handId, outcome, winningContract: winning, accounts, at: this.now() };
    this.settlements.set(handId, rec);
    return rec;
  }

  // ------------------------------------------------------------ views

  depth(contract: ContractId, levels = 6): { bids: { price: number; qty: number; orders: number }[]; asks: { price: number; qty: number; orders: number }[] } {
    const agg = (book: Order[]) => {
      const out: { price: number; qty: number; orders: number }[] = [];
      for (const o of book) {
        const last = out[out.length - 1];
        if (last && last.price === o.price) {
          last.qty += o.qty;
          last.orders++;
        } else if (out.length < levels) out.push({ price: o.price, qty: o.qty, orders: 1 });
        else break;
      }
      return out;
    };
    return { bids: agg(this.bids[contract]), asks: agg(this.asks[contract]) };
  }

  /** Best bid/ask price and the quantity available at it, optionally ignoring one account's orders. */
  topOfBook(contract: ContractId, excludeAccount?: string): { bid: number | null; bidQty: number; ask: number | null; askQty: number } {
    const level = (book: Order[]) => {
      const live = book.filter((o) => o.accountId !== excludeAccount);
      if (!live.length) return { px: null, qty: 0 };
      const px = live[0].price;
      return { px, qty: live.filter((o) => o.price === px).reduce((s, o) => s + o.qty, 0) };
    };
    const b = level(this.bids[contract]), a = level(this.asks[contract]);
    return { bid: b.px, bidQty: b.qty, ask: a.px, askQty: a.qty };
  }

  best(contract: ContractId): { bid: Order | null; ask: Order | null } {
    return { bid: this.bids[contract][0] ?? null, ask: this.asks[contract][0] ?? null };
  }

  /** Invariant check used by tests: no account may have negative available credits. */
  checkInvariants(): void {
    for (const a of this.accounts.values()) {
      if (a.kind === "house") continue;
      const av = this.available(a.id);
      if (av < 0) throw new Error(`account ${a.id} available ${av} < 0`);
    }
    for (const o of this.orders.values()) {
      if (o.reservedCash < 0 || o.coveredRemaining < 0) throw new Error(`order ${o.id} negative reservation`);
    }
  }
}
