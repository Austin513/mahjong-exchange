import { describe, expect, it } from "vitest";
import { Exchange } from "../src/market/exchange";
import { CONTRACTS, type ContractId, type PlaceResult } from "../src/market/types";
import { makeRng, randInt } from "../src/engine/rng";

function setup(...ids: string[]) {
  const ex = new Exchange(() => 0);
  for (const id of ids) ex.ensureAccount(id, id, "human");
  ex.openHand("h1");
  return ex;
}

const ok = (r: ReturnType<Exchange["place"]>): PlaceResult => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("worked example: buy 10 @ 32, payout 100", () => {
  const trade = (contract: ContractId = "SEAT_1") => {
    const ex = setup("me", "seller");
    ok(ex.place({ accountId: "seller", contract, side: "sell", price: 32, qty: 10, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "me", contract, side: "buy", price: 32, qty: 10, tif: "ioc" }));
    expect(r.status).toBe("filled");
    return ex;
  };

  it("holding to a win: buyer +680, seller −680", () => {
    const ex = trade();
    const rec = ex.settle("h1", 1);
    expect(rec.accounts.me.pnl).toBe(680);
    expect(rec.accounts.seller.pnl).toBe(-680);
    expect(ex.accounts.get("me")!.cash).toBe(10_680);
    expect(ex.accounts.get("seller")!.cash).toBe(9_320);
  });

  it("expiring worthless: buyer −320, seller +320", () => {
    const ex = trade();
    const rec = ex.settle("h1", 2);
    expect(rec.accounts.me.pnl).toBe(-320);
    expect(rec.accounts.seller.pnl).toBe(320);
  });

  it("draw: the DRAW contract pays, every seat contract expires", () => {
    const ex = trade("DRAW");
    const rec = ex.settle("h1", "draw");
    expect(rec.winningContract).toBe("DRAW");
    expect(rec.accounts.me.pnl).toBe(680);
    expect(rec.accounts.seller.pnl).toBe(-680);
    const ex2 = trade("SEAT_0");
    expect(ex2.settle("h1", "draw").accounts.me.pnl).toBe(-320);
  });

  it("locks the seller's worst-case payout while short", () => {
    const ex = trade();
    // seller received 320, owes up to 1000 → 680 net of their own money is locked
    expect(ex.available("seller")).toBe(10_000 + 320 - 1000);
    expect(ex.available("me")).toBe(10_000 - 320);
  });
});

describe("partial fills and cancels release the right amounts", () => {
  it("both sides' available credit after a partial fill and a cancelled remainder", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_0", side: "sell", price: 40, qty: 10, tif: "gtc" }));
    expect(ex.available("B")).toBe(10_000 - 10 * 60); // short reservation (100−40)×10
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 40, qty: 20, tif: "gtc" }));
    expect(r.status).toBe("partial-resting");
    expect(r.fills).toHaveLength(1);
    // A: paid 400 for 10, still reserves 10 × 40 for the resting remainder
    expect(ex.available("A")).toBe(10_000 - 400 - 400);
    // B: received 400, short 10 locks 1000, order reservation released
    expect(ex.available("B")).toBe(10_400 - 1000);
    const c = ex.cancel("A", r.order.id);
    expect(c.ok).toBe(true);
    expect(ex.available("A")).toBe(10_000 - 400);
    ex.checkInvariants();
  });

  it("fills at the resting price and releases the difference to the taker", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_2", side: "sell", price: 30, qty: 5, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_2", side: "buy", price: 35, qty: 5, tif: "gtc" }));
    expect(r.fills[0].price).toBe(30);
    expect(ex.available("A")).toBe(10_000 - 150);
  });

  it("settlement cancels open orders and frees every reservation", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 20, qty: 50, tif: "gtc" }));
    ok(ex.place({ accountId: "B", contract: "DRAW", side: "sell", price: 10, qty: 30, tif: "gtc" }));
    ex.settle("h1", 3);
    expect(ex.available("A")).toBe(ex.accounts.get("A")!.cash);
    expect(ex.available("B")).toBe(ex.accounts.get("B")!.cash);
    expect(ex.openOrdersOf("A")).toHaveLength(0);
  });
});

describe("matching engine", () => {
  it("uses price-time priority across levels", () => {
    const ex = setup("A", "B", "C", "D");
    const b = ok(ex.place({ accountId: "B", contract: "SEAT_1", side: "sell", price: 35, qty: 10, tif: "gtc" }));
    const c = ok(ex.place({ accountId: "C", contract: "SEAT_1", side: "sell", price: 35, qty: 10, tif: "gtc" }));
    const d = ok(ex.place({ accountId: "D", contract: "SEAT_1", side: "sell", price: 34, qty: 10, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "buy", price: 35, qty: 25, tif: "ioc" }));
    expect(r.fills.map((f) => [f.sellOrderId, f.price, f.qty])).toEqual([
      [d.order.id, 34, 10],
      [b.order.id, 35, 10],
      [c.order.id, 35, 5],
    ]);
    expect(ex.depth("SEAT_1").asks).toEqual([{ price: 35, qty: 5, orders: 1 }]);
  });

  it("respects the limit: a non-marketable order rests without trading", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_1", side: "sell", price: 34, qty: 10, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "buy", price: 30, qty: 10, tif: "gtc" }));
    expect(r.status).toBe("resting");
    expect(ex.depth("SEAT_1")).toEqual({ bids: [{ price: 30, qty: 10, orders: 1 }], asks: [{ price: 34, qty: 10, orders: 1 }] });
  });

  it("IOC remainder is cancelled, not rested", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_1", side: "sell", price: 34, qty: 3, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "buy", price: 40, qty: 10, tif: "ioc" }));
    expect(r.status).toBe("partial-cancelled");
    expect(ex.depth("SEAT_1").bids).toEqual([]);
    expect(ex.available("A")).toBe(10_000 - 3 * 34);
  });

  it("prevents self-trades by cancelling the resting order and continuing to match", () => {
    const ex = setup("A", "C");
    ok(ex.place({ accountId: "C", contract: "SEAT_3", side: "sell", price: 34, qty: 10, tif: "gtc" }));
    const own = ok(ex.place({ accountId: "A", contract: "SEAT_3", side: "sell", price: 35, qty: 10, tif: "gtc" }));
    const r = ok(ex.place({ accountId: "A", contract: "SEAT_3", side: "buy", price: 36, qty: 15, tif: "gtc" }));
    expect(r.fills.map((f) => f.seller)).toEqual(["C"]);
    expect(r.stpCancelled.map((o) => o.id)).toEqual([own.order.id]);
    expect(ex.orders.get(own.order.id)!.cancelReason).toBe("stp");
    expect(r.status).toBe("partial-resting");
    expect(ex.depth("SEAT_3").bids).toEqual([{ price: 36, qty: 5, orders: 1 }]);
    expect(ex.trades.every((t) => t.buyer !== t.seller)).toBe(true);
  });

  it("the same resting shares cannot be filled twice by two simultaneous clicks", () => {
    const ex = setup("A", "B", "S");
    ok(ex.place({ accountId: "S", contract: "SEAT_0", side: "sell", price: 30, qty: 10, tif: "gtc" }));
    const a = ok(ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 30, qty: 10, tif: "ioc" }));
    const b = ok(ex.place({ accountId: "B", contract: "SEAT_0", side: "buy", price: 30, qty: 10, tif: "ioc" }));
    expect(a.status).toBe("filled");
    expect(b.status).toBe("cancelled");
    expect(ex.accounts.get("S")!.positions.SEAT_0).toBe(-10);
  });
});

describe("collateral", () => {
  it("rejects orders that cannot be funded, with an actionable message", () => {
    const ex = setup("A");
    const buy = ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 60, qty: 200, tif: "gtc" });
    expect(buy).toMatchObject({ ok: false, code: "insufficient_funds" });
    if (!buy.ok) expect(buy.message).toMatch(/needs 12000.*10000 available/);
    const short = ex.place({ accountId: "A", contract: "SEAT_0", side: "sell", price: 40, qty: 200, tif: "gtc" });
    expect(short).toMatchObject({ ok: false, code: "insufficient_funds" });
  });

  it("covered sells reserve shares, not cash; the uncovered part reserves (100 − price)", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_1", side: "sell", price: 30, qty: 10, tif: "gtc" }));
    ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "buy", price: 30, qty: 10, tif: "ioc" }));
    const before = ex.available("A");
    const covered = ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "sell", price: 50, qty: 10, tif: "gtc" }));
    expect(covered.order.reservedCash).toBe(0);
    expect(ex.available("A")).toBe(before);
    const naked = ok(ex.place({ accountId: "A", contract: "SEAT_1", side: "sell", price: 50, qty: 10, tif: "gtc" }));
    expect(naked.order.reservedCash).toBe(500); // the long is already committed
    ex.checkInvariants();
  });

  it("a brand-new account can post a two-sided quote on every contract", () => {
    const ex = setup("mm");
    for (const c of CONTRACTS) {
      ok(ex.place({ accountId: "mm", contract: c, side: "buy", price: 18, qty: 10, tif: "gtc" }));
      ok(ex.place({ accountId: "mm", contract: c, side: "sell", price: 24, qty: 10, tif: "gtc" }));
    }
    expect(ex.available("mm")).toBe(10_000 - 5 * (180 + 760));
  });
});

describe("settlement", () => {
  it("is exactly-once: retries change nothing and the market closes", () => {
    const ex = setup("A", "B");
    ok(ex.place({ accountId: "B", contract: "SEAT_0", side: "sell", price: 25, qty: 4, tif: "gtc" }));
    ok(ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 25, qty: 4, tif: "ioc" }));
    const r1 = ex.settle("h1", 0);
    const cash = ex.accounts.get("A")!.cash;
    const r2 = ex.settle("h1", 0);
    expect(r2).toBe(r1);
    expect(ex.accounts.get("A")!.cash).toBe(cash);
    expect(ex.accounts.get("A")!.settledPnl).toBe(300);
    expect(ex.place({ accountId: "A", contract: "SEAT_0", side: "buy", price: 25, qty: 1, tif: "gtc" })).toMatchObject({ ok: false, code: "market_closed" });
  });

  it("random order flow conserves cash and shares and never makes available negative", () => {
    const rng = makeRng("fuzz");
    for (let round = 0; round < 5; round++) {
      const ids = ["a", "b", "c", "d", "e"];
      const ex = setup(...ids);
      const total = () => ids.reduce((s, id) => s + ex.accounts.get(id)!.cash, 0);
      const start = total();
      for (let i = 0; i < 1500; i++) {
        const id = ids[randInt(rng, ids.length)];
        if (rng() < 0.15) {
          const open = ex.openOrdersOf(id);
          if (open.length) ex.cancel(id, open[randInt(rng, open.length)].id);
        } else {
          ex.place({ accountId: id, contract: CONTRACTS[randInt(rng, 5)], side: rng() < 0.5 ? "buy" : "sell", price: 1 + randInt(rng, 99), qty: 1 + randInt(rng, 40), tif: rng() < 0.3 ? "ioc" : "gtc" });
        }
        ex.checkInvariants();
        expect(total()).toBe(start);
        for (const c of CONTRACTS) expect(ids.reduce((s, x) => s + ex.accounts.get(x)!.positions[c], 0)).toBe(0);
      }
      ex.settle("h1", ([0, "draw", 2, "draw", 3] as const)[round]);
      expect(total()).toBe(start);
      for (const id of ids) expect(ex.available(id)).toBe(ex.accounts.get(id)!.cash);
    }
  });
});
