import { describe, expect, it } from "vitest";
import { startHand } from "../src/engine/game";
import { publicView, type PublicTableView } from "../src/engine/views";
import { defaultConfig } from "../src/bots/mahjong/runner";
import { outcomeProbabilities } from "../src/pricing/model";
import { quote, FIXED_SPREAD, INVENTORY_AWARE } from "../src/pricing/quoter";
import { emptyPositions } from "../src/market/types";
import { informedDistribution } from "../src/pricing/informed";

function baseView(): PublicTableView {
  return publicView(startHand(defaultConfig("pricing-fixture", 1, 0)));
}

/** Public-state fixtures built by editing a public view (the model only ever sees this). */
function withRiichi(v: PublicTableView, seat: number): PublicTableView {
  const w = structuredClone(v);
  w.seats[seat].riichi = true;
  w.seats[seat].discards = [{ tile: 120, tsumogiri: false, riichi: true, calledBy: null }];
  return w;
}

describe("public outcome model", () => {
  it("returns five probabilities that sum to one", () => {
    const p = outcomeProbabilities(baseView());
    expect(p).toHaveLength(5);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (const x of p) expect(x).toBeGreaterThan(0);
  });

  it("raises a seat's price when it declares riichi and lowers the others", () => {
    const v = baseView();
    const before = outcomeProbabilities(v);
    const after = outcomeProbabilities(withRiichi(v, 2));
    expect(after[2]).toBeGreaterThan(before[2] + 0.1);
    for (const s of [0, 1, 3]) expect(after[s]).toBeLessThan(before[s]);
  });

  it("raises the draw price as the wall runs out", () => {
    const v = baseView();
    const early = outcomeProbabilities(v);
    const late = outcomeProbabilities({ ...v, wallCount: 4 });
    const last = outcomeProbabilities({ ...v, wallCount: 0 });
    expect(late[4]).toBeGreaterThan(early[4]);
    expect(last[4]).toBeGreaterThan(late[4]);
  });

  it("responds to an exposed yakuhai pon", () => {
    const v = baseView();
    const w = structuredClone(v);
    w.seats[1].melds = [{ type: "pon", tiles: [124, 125, 126], called: 124, from: 0 }]; // red dragon
    w.seats[1].handCount = 11;
    expect(outcomeProbabilities(w)[1]).toBeGreaterThan(outcomeProbabilities(v)[1]);
  });

  it("depends only on public information: different concealed tiles, identical prices", () => {
    const s = startHand(defaultConfig("hidden-swap", 1, 0));
    const p1 = outcomeProbabilities(publicView(s));
    // Swap concealed hands between seats 1 and 2 (public view unchanged).
    [s.hands[1], s.hands[2]] = [s.hands[2], s.hands[1]];
    s.wall.reverse();
    const p2 = outcomeProbabilities(publicView(s));
    expect(p2).toEqual(p1);
  });
});

describe("house quoter", () => {
  const probs = [0.3, 0.2, 0.2, 0.2, 0.1];

  it("quotes a spread around fair value", () => {
    const q = quote(probs, emptyPositions(), FIXED_SPREAD);
    expect(q[0]).toMatchObject({ bid: 27, ask: 33, size: 20 });
    expect(q[4]).toMatchObject({ bid: 7, ask: 13 });
  });

  it("separates fair value from the quote and leans against inventory", () => {
    const inv = { ...emptyPositions(), SEAT_0: 100 }; // house is long 100 Seat A
    const fixed = quote(probs, inv, FIXED_SPREAD)[0];
    const aware = quote(probs, inv, INVENTORY_AWARE)[0];
    expect(aware.fair).toBe(fixed.fair);
    expect(aware.ask!).toBeLessThan(fixed.ask!); // eager to sell what it holds
    expect(aware.bid!).toBeLessThan(fixed.bid!); // reluctant to buy more
  });

  it("withdraws a side at the inventory limit and clamps prices to 1..99", () => {
    const q = quote([0.995, 0.001, 0.001, 0.001, 0.002], { ...emptyPositions(), SEAT_1: -400 }, INVENTORY_AWARE);
    expect(q[0].ask).toBe(99);
    expect(q[1].ask).toBeNull();
    expect(q[2].bid).toBeGreaterThanOrEqual(1);
  });
});

describe("informed seat model", () => {
  it("prices a tenpai hand with many live outs above the public estimate", () => {
    const pub = [0.22, 0.22, 0.22, 0.22, 0.12];
    const tenpai = informedDistribution(pub, 1, { shanten: 0, ukeire: 8 }, 0.4);
    const far = informedDistribution(pub, 1, { shanten: 3, ukeire: 20 }, 0.4);
    expect(tenpai[1]).toBeGreaterThan(pub[1]);
    expect(far[1]).toBeLessThan(pub[1]);
    expect(tenpai.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});
