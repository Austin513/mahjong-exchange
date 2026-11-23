import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketRoom, HOUSE_ID } from "../src/server/marketRoom";
import { FakeClient, runUntil, tick } from "./helpers";
import { CONTRACTS } from "../src/market/types";

let room: MarketRoom;
const make = (mode: "house" | "exchange", settings = {}) =>
  new MarketRoom({ code: "MKT01", mode, seed: "market-test", settings: { botDelayMs: 0, turnSeconds: 5, claimSeconds: 3, ...settings } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  room?.dispose();
  vi.useRealTimers();
});

function botTable(host: FakeClient, humanSeat: number | null = null) {
  if (humanSeat !== null) host.send({ t: "sit", seat: humanSeat });
  for (let s = 0; s < 4; s++) if (s !== humanSeat) host.send({ t: "addBot", seat: s, bot: "smart" });
}

describe("Trade Against the House", () => {
  beforeEach(() => {
    room = make("house", { botDelayMs: 100000 }); // freeze bots so quotes stay put during a test
  });

  it("quotes a bid below and an ask above fair value on all five contracts as soon as the hand is dealt", () => {
    const host = new FakeClient(room, "Host");
    botTable(host);
    host.send({ t: "start" });
    tick();
    const shared = host.state!.market!.shared;
    expect(shared.status).toBe("open");
    expect(shared.contracts).toHaveLength(5);
    for (const c of shared.contracts) {
      expect(c.house).toBeDefined();
      const h = c.house!;
      expect(h.bid!).toBeLessThan(h.fair);
      expect(h.ask!).toBeGreaterThan(h.fair);
      expect(h.askSize).toBeGreaterThan(0);
    }
    const sum = shared.fairSeries.at(-1)!.probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("fills a click at the quoted ask, updates position and house inventory, and re-quotes", () => {
    const host = new FakeClient(room, "Host");
    botTable(host);
    const spec = new FakeClient(room, "Spec");
    host.send({ t: "start" });
    tick();
    const c0 = spec.state!.market!.shared.contracts[1].house!;
    spec.send({ t: "order", handId: room.hand!.handId, contract: "SEAT_1", side: "buy", price: c0.ask!, qty: 5, tif: "ioc" });
    tick();
    const st = spec.state!.market!;
    expect(st.mine!.account.positions.SEAT_1).toBe(5);
    expect(st.mine!.account.cash).toBe(10_000 - 5 * c0.ask!);
    expect(st.shared.house!.inventory.SEAT_1).toBe(-5);
    // inventory-aware: house is now short, so its quotes do not get cheaper
    expect(st.shared.contracts[1].house!.ask!).toBeGreaterThanOrEqual(c0.ask!);
    expect(st.mine!.fills[0]).toMatchObject({ side: "buy", qty: 5, price: c0.ask });
  });

  it("stale quotes: a worse price is rejected with the refreshed quote; a better price fills at the house price", () => {
    const host = new FakeClient(room, "Host");
    botTable(host);
    const spec = new FakeClient(room, "Spec");
    host.send({ t: "start" });
    tick();
    const q = spec.state!.market!.shared.contracts[2].house!;
    const handId = room.hand!.handId;
    // The user saw an ask 2 ticks lower than the current one (quote moved up since).
    spec.send({ t: "order", handId, contract: "SEAT_2", side: "buy", price: q.ask! - 2, qty: 3, tif: "ioc" });
    expect(spec.lastError?.code).toBe("quote_moved");
    expect(spec.lastError?.message).toContain(`is ${q.ask}`);
    expect(room.exchange.accounts.get(spec.participantId)!.positions.SEAT_2).toBe(0);
    // The user saw a higher ask (quote moved down since): they get the better house price.
    spec.send({ t: "order", handId, contract: "SEAT_2", side: "buy", price: q.ask! + 3, qty: 3, tif: "ioc" });
    tick();
    expect(spec.state!.market!.mine!.fills[0].price).toBe(q.ask);
  });

  it("rejects resting orders in House mode", () => {
    const host = new FakeClient(room, "Host");
    botTable(host);
    host.send({ t: "start" });
    host.send({ t: "order", handId: room.hand!.handId, contract: "DRAW", side: "buy", price: 5, qty: 1, tif: "gtc" });
    expect(host.lastError?.code).toBe("house_ioc_only");
  });
});

describe("settlement through the room", () => {
  it("closes atomically with the winning action, pays exactly once, and reopens next hand", () => {
    room = make("house");
    const host = new FakeClient(room, "Host");
    botTable(host);
    const spec = new FakeClient(room, "Spec");
    host.send({ t: "start" });
    tick();
    // Buy a little of every contract so exactly one of them pays.
    for (const c of CONTRACTS) {
      const ask = spec.state!.market!.shared.contracts[CONTRACTS.indexOf(c)].house!.ask!;
      spec.send({ t: "order", handId: room.hand!.handId, contract: c, side: "buy", price: ask, qty: 2, tif: "ioc" });
      tick();
    }
    const spent = 10_000 - room.exchange.accounts.get(spec.participantId)!.cash;
    // Instrument: from the moment the hand ends no order may be accepted.
    let acceptedAfterEnd = 0;
    const origPlace = room.exchange.place.bind(room.exchange);
    room.exchange.place = (input) => {
      const r = origPlace(input);
      if (room.hand?.phase === "ended" && r.ok) acceptedAfterEnd++;
      return r;
    };
    runUntil(() => room.phase === "hand-over", 50, 20000, () => {
      spec.send({ t: "order", handId: room.hand!.handId, contract: "DRAW", side: "buy", price: 99, qty: 1, tif: "ioc" });
    });
    expect(room.exchange.status).toBe("closed");
    expect(acceptedAfterEnd).toBe(0);
    const outcome = room.outcome()!;
    const rec = room.exchange.settle(room.hand!.handId, outcome); // retry: no-op
    expect(rec).toBe(room.exchange.settlements.get(room.hand!.handId));
    const acct = room.exchange.accounts.get(spec.participantId)!;
    expect(Object.values(acct.positions).every((p) => p === 0)).toBe(true);
    expect(room.exchange.available(spec.participantId)).toBe(acct.cash);
    tick();
    const mine = spec.state!.market!.mine!;
    expect(mine.settlement?.handId).toBe(room.hand!.handId);
    expect(mine.account.settledPnl).toBe(acct.cash - 10_000);
    expect(spent).toBeGreaterThan(0);
    // Late order is rejected with a clear message; next hand reopens the market.
    spec.send({ t: "order", handId: room.hand!.handId, contract: "DRAW", side: "buy", price: 50, qty: 1, tif: "ioc" });
    expect(spec.lastError?.message).toMatch(/opens when a hand is dealt/);
    host.send({ t: "start" });
    expect(room.exchange.status).toBe("open");
  });
});

describe("Open Exchange", () => {
  it("matches human to human with no house and no trading bots", () => {
    room = make("exchange", { botDelayMs: 100000 });
    const host = new FakeClient(room, "Host");
    botTable(host);
    const a = new FakeClient(room, "Alice");
    const b = new FakeClient(room, "Bob");
    const c = new FakeClient(room, "Carol");
    host.send({ t: "start" });
    tick();
    expect(room.exchange.accounts.has(HOUSE_ID)).toBe(false);
    expect(a.state!.market!.shared.contracts[0].bids).toEqual([]); // empty book
    const handId = room.hand!.handId;
    a.send({ t: "order", handId, contract: "SEAT_0", side: "buy", price: 30, qty: 10, tif: "gtc" });
    b.send({ t: "order", handId, contract: "SEAT_0", side: "sell", price: 34, qty: 10, tif: "gtc" });
    tick();
    const book = c.state!.market!.shared.contracts[0];
    expect(book.bids).toEqual([{ price: 30, qty: 10, orders: 1 }]);
    expect(book.asks).toEqual([{ price: 34, qty: 10, orders: 1 }]);
    c.send({ t: "order", handId, contract: "SEAT_0", side: "sell", price: 30, qty: 4, tif: "gtc" });
    tick();
    expect(room.exchange.trades).toHaveLength(1);
    expect(room.exchange.trades[0]).toMatchObject({ buyer: a.participantId, seller: c.participantId, price: 30, qty: 4 });
    const aOrders = a.state!.market!.mine!.openOrders;
    expect(aOrders[0]).toMatchObject({ qty: 6, filledQty: 4, status: "open" });
    expect(a.messages.some((m) => m.t === "notice" && m.text.includes("filled: 4 @ 30"))).toBe(true);
    a.send({ t: "cancel", orderId: aOrders[0].id });
    tick();
    expect(a.state!.market!.mine!.openOrders).toEqual([]);
    expect(a.state!.market!.mine!.account.available).toBe(10_000 - 120);
  });

  it("blocks seated players from trading when the host disables it", () => {
    room = make("exchange", { botDelayMs: 100000, seatedCanTrade: false });
    const host = new FakeClient(room, "Host");
    botTable(host, 0);
    host.send({ t: "start" });
    tick();
    expect(host.state!.you.canTrade).toBe(false);
    host.send({ t: "order", handId: room.hand!.handId, contract: "SEAT_0", side: "buy", price: 30, qty: 1, tif: "gtc" });
    expect(host.lastError?.code).toBe("trade_blocked");
  });
});
