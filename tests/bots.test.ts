import { describe, expect, it } from "vitest";
import { applyAction } from "../src/engine/game";
import { kindOf, parseKinds, type Seat, type TileId } from "../src/engine/tiles";
import type { HandState } from "../src/engine/types";
import { seatView } from "../src/engine/views";
import { chooseAction } from "../src/bots/mahjong/smart";
import { defaultConfig, makePolicy, playHand } from "../src/bots/mahjong/runner";
import { fixtureHand } from "./fixtures";

const K = (m: string) => parseKinds(m)[0];

/** Move copies of a kind from the live wall into `seat`'s discard pile (visible to everyone). */
function discardFromWall(s: HandState, seat: Seat, mpsz: string, n: number, riichiFirst = false): TileId[] {
  const moved: TileId[] = [];
  for (let i = 0; i < n; i++) {
    // Take from the live wall, or from the dead wall if the fixture filler put it there.
    const src = s.wall.some((t) => kindOf(t) === K(mpsz)) ? s.wall : s.deadWall;
    const idx = src.findIndex((t, i) => kindOf(t) === K(mpsz) && (src === s.wall || i !== 4));
    if (idx < 0) throw new Error(`no ${mpsz} left in the walls`);
    const tile = src.splice(idx, 1)[0];
    s.discards[seat].push({ tile, tsumogiri: true, riichi: riichiFirst && i === 0, calledBy: null });
    moved.push(tile);
  }
  return moved;
}

describe("smart bot: fixed positions", () => {
  // 123m 456p 789s EEE + 5m + 9p: either discard leaves a single-tile (tanki) wait.
  const spec = {
    hands: { 0: "123m456p789s111z5m", 1: "222m888m111p888p1s", 2: "333m777m222p777p2s", 3: "444m666m333p666p3s" },
    draws: "9p",
    dora: "4z",
  } as const;

  it("prefers the wait with more unseen copies (visible-tile ukeire)", () => {
    const s = fixtureHand(spec);
    discardFromWall(s, 2, "5m", 3); // all other 5m are visible: a 5m wait would be dead
    const a = chooseAction(seatView(s, 0));
    expect(a.type).toBe("discard");
    if (a.type === "discard") expect(kindOf(a.tile)).toBe(K("5m"));

    const t = fixtureHand(spec);
    discardFromWall(t, 2, "9p", 3); // now the 9p wait is dead instead
    const b = chooseAction(seatView(t, 0));
    if (b.type === "discard") expect(kindOf(b.tile)).toBe(K("9p"));
  });

  it("declares riichi when closed and tenpai with live waits", () => {
    const s = fixtureHand(spec);
    const a = chooseAction(seatView(s, 0));
    expect(a).toMatchObject({ type: "discard", riichi: true });
  });

  it("discards an isolated non-value honor before breaking connected shapes", () => {
    const s = fixtureHand({ hands: { 0: "4567m24p159s235z7z" }, draws: "9p" }, { dealer: 0 });
    // seat 0 is East; South (2z) and West (3z) are guest winds (no yaku value)
    const a = chooseAction(seatView(s, 0));
    if (a.type !== "discard") throw new Error("expected discard");
    expect([K("2z"), K("3z")]).toContain(kindOf(a.tile));
  });

  it("folds against riichi: discards genbutsu instead of the most efficient tile", () => {
    const s = fixtureHand({ hands: { 0: "4567m24p159s235z7z" }, draws: "9p" });
    discardFromWall(s, 1, "7m", 1, true);
    s.riichi[1] = { discardIndex: 0, ippatsu: false };
    const a = chooseAction(seatView(s, 0));
    if (a.type !== "discard") throw new Error("expected discard");
    expect(kindOf(a.tile)).toBe(K("7m")); // 100% safe vs the riichi; offense would cut an honor
  });

  it("pons a dragon (yakuhai) but passes a pon that leaves the hand without a yaku", () => {
    const s = fixtureHand({
      hands: { 0: "5z9m19p19s1234z67z8s", 1: "55z9m9m1s3s5s7p8p2m3m4z6s", 2: "147m258p369s1z2z3z5m", 3: "222m888m111p777s1s" },
      draws: "6z",
    });
    applyAction(s, 0, { type: "discard", tile: s.hands[0].find((t) => kindOf(t) === K("5z"))! });
    expect(chooseAction(seatView(s, 1))).toMatchObject({ type: "pon" });

    const t = fixtureHand({
      hands: { 0: "9m19p19s1234z567z8s", 1: "9m9m1s9s1p7p2z3z4z6z1m4m7m", 2: "147p258p369s1z2z3z5m", 3: "222m888m333p888s3s" },
      draws: "6z",
    });
    applyAction(t, 0, { type: "discard", tile: t.hands[0].find((x) => kindOf(x) === K("9m"))! });
    const opts = seatView(t, 1).me.legal.claim;
    expect(opts.some((o) => o.type === "pon")).toBe(true);
    expect(chooseAction(seatView(t, 1))).toEqual({ type: "pass" });
  });
});

describe("bot legality and strength", () => {
  it("smart, greedy, and random bots only make legal moves across many seeded hands", () => {
    for (let i = 0; i < 30; i++) {
      const names = (["smart", "random", "greedy", "smart"] as const).map((n, j) => makePolicy(n, `p${i}-${j}`));
      const s = playHand(defaultConfig(`legal-${i}`, 1, (i % 4) as Seat), names);
      expect(s.phase).toBe("ended");
    }
  });

  it("a smart bot wins far more often than random bots at the same table", () => {
    let smartWins = 0, randomWins = 0;
    for (let i = 0; i < 24; i++) {
      const smartSeat = (i % 4) as Seat;
      const pols = [0, 1, 2, 3].map((x) => makePolicy(x === smartSeat ? "smart" : "random", `r${i}-${x}`));
      const s = playHand(defaultConfig(`strength-${i}`, 1, 0), pols);
      if (s.result?.type === "win") {
        if (s.result.winner === smartSeat) smartWins++;
        else randomWins++;
      }
    }
    expect(smartWins).toBeGreaterThanOrEqual(12);
    expect(smartWins).toBeGreaterThan(randomWins * 4);
  });
});
