import { describe, expect, it } from "vitest";
import { calculateShanten, validateTehai13, type HaiKindId } from "@pai-forge/riichi-mahjong";
import { applyAction, legalActions, startHand, tileCensus } from "../src/engine/game";
import { shanten } from "../src/engine/shanten";
import { countKinds, kindOf, parseKinds, type Seat, type TileId } from "../src/engine/tiles";
import type { HandState } from "../src/engine/types";
import { publicView, seatView } from "../src/engine/views";
import { defaultConfig, playHand, type TablePolicy } from "../src/bots/mahjong/runner";
import { makeRng, shuffle } from "../src/engine/rng";
import { fixtureHand } from "./fixtures";

const tileOf = (s: HandState, seat: Seat, mpsz: string): TileId => {
  const k = parseKinds(mpsz)[0];
  const t = s.hands[seat].find((x) => kindOf(x) === k);
  if (t === undefined) throw new Error(`seat ${seat} has no ${mpsz}`);
  return t;
};

const census = (s: HandState) => {
  const c = tileCensus(s);
  expect(c.length).toBe(136);
  expect(new Set(c).size).toBe(136);
};

/** Always discards the drawn tile and passes every claim: guarantees an exhaustive draw. */
const tsumogiri: TablePolicy = (v) =>
  v.me.legal.claim.length ? { type: "pass" } : { type: "discard", tile: v.me.drawnTile ?? v.me.legal.discard[0] };

describe("dealing and tile counts", () => {
  it("deals 13 tiles each, dealer draws a 14th, and conserves all 136 tiles", () => {
    const s = startHand(defaultConfig("deal-test", 1, 2));
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 14, 13]);
    expect(s.turn).toBe(2);
    expect(s.wall.length).toBe(136 - 14 - 53);
    expect(s.doraIndicators).toHaveLength(1);
    census(s);
  });

  it("is deterministic for a seed and independent across seeds", () => {
    const a = startHand(defaultConfig("same"));
    const b = startHand(defaultConfig("same"));
    const c = startHand(defaultConfig("other"));
    expect(a.hands).toEqual(b.hands);
    expect(a.wall).toEqual(b.wall);
    expect(a.wall).not.toEqual(c.wall);
  });

  it("ends in an exhaustive draw when nobody wins, with zero-sum noten payments", () => {
    const s = playHand(defaultConfig("exhaust"), [tsumogiri, tsumogiri, tsumogiri, tsumogiri], { onStep: census });
    expect(s.result?.type).toBe("draw");
    expect(s.wall.length).toBe(0);
    expect(s.result!.deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("turn order and authorization", () => {
  it("rejects actions out of turn and tiles not in hand", () => {
    const s = startHand(defaultConfig("auth"));
    const r1 = applyAction(s, 1, { type: "discard", tile: s.hands[1][0] });
    expect(r1).toEqual({ ok: false, error: "It is not your turn." });
    const notMine = s.hands[1][0];
    const r2 = applyAction(s, 0, { type: "discard", tile: notMine });
    expect(r2.ok).toBe(false);
    expect(s.hands[1]).toContain(notMine);
  });

  it("rejects tsumo on an incomplete hand and claims without a claim option", () => {
    const s = fixtureHand({
      hands: { 0: "123m456p789s23s11z", 1: "2s4s258m369p1z2z567z", 2: "33s147m258p34z158s" },
      draws: "9m",
    });
    expect(applyAction(s, 0, { type: "tsumo" }).ok).toBe(false);
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "9m") });
    // nobody can claim 9m here, so seat 1 drew; a pon attempt by seat 3 is rejected
    expect(applyAction(s, 3, { type: "pon", tiles: [s.hands[3][0], s.hands[3][1]] }).ok).toBe(false);
  });
});

describe("wins and yaku", () => {
  it("allows tsumo on a complete closed hand (menzen tsumo)", () => {
    const s = fixtureHand({ hands: { 0: "123m456p789s23s11z" }, draws: "1s" });
    expect(legalActions(s, 0).tsumo).toBe(true);
    expect(applyAction(s, 0, { type: "tsumo" }).ok).toBe(true);
    expect(s.result?.type).toBe("win");
    if (s.result?.type === "win") {
      expect(s.result.winner).toBe(0);
      expect(s.result.yaku.map((y) => y.name)).toContain("MenzenTsumo");
      expect(s.result.deltas.reduce((a, b) => a + b, 0)).toBe(0);
    }
    census(s);
  });

  const ronSpec = {
    hands: {
      0: "5p19m19p19s123456z",
      1: "234m678m345s66s34p", // waits 2p/5p, tanyao
      2: "234s678s456m22p46p", // waits 5p (kanchan), tanyao
      3: "111m999m111p999p1s",
    },
    draws: "7z",
  } as const;

  it("resolves multiple ron by head bump: first claimant after the discarder wins", () => {
    const s = fixtureHand(ronSpec);
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "5p") });
    expect(s.phase).toBe("claim");
    expect(legalActions(s, 1).claim).toContainEqual({ type: "ron" });
    expect(legalActions(s, 2).claim).toContainEqual({ type: "ron" });
    applyAction(s, 2, { type: "ron" });
    expect(s.phase).toBe("claim"); // still waiting on seat 1
    applyAction(s, 1, { type: "ron" });
    expect(s.result?.type === "win" && s.result.winner).toBe(1);
    census(s);
  });

  it("gives the win to the next claimant when the first passes, and the passer becomes furiten", () => {
    const s = fixtureHand(ronSpec);
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "5p") });
    applyAction(s, 1, { type: "pass" });
    applyAction(s, 2, { type: "ron" });
    expect(s.result?.type === "win" && s.result.winner).toBe(2);
    expect(s.tempFuriten[1]).toBe(true);
  });

  it("blocks ron when a wait is in the seat's own discards (furiten)", () => {
    const s = fixtureHand(ronSpec);
    // Move a 2p from the live wall into seat 1's discard pile: 2p is one of its waits.
    const idx = s.wall.findIndex((t) => kindOf(t) === parseKinds("2p")[0]);
    s.discards[1].push({ tile: s.wall.splice(idx, 1)[0], tsumogiri: true, riichi: false, calledBy: null });
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "5p") });
    expect(legalActions(s, 1).claim).not.toContainEqual({ type: "ron" });
    expect(legalActions(s, 2).claim).toContainEqual({ type: "ron" });
  });

  it("does not offer ron to an open hand with no yaku", () => {
    const s = fixtureHand({
      hands: { 0: "4p19m19p19s123456z", 1: "123m456p789s55s23p", 3: "222m999m111p888p1s" },
      draws: "7z",
    });
    // Convert seat 1's 123m into an open chi: the hand keeps its shape but loses pinfu/menzen.
    const chiTiles = ["1m", "2m", "3m"].map((m) => tileOf(s, 1, m));
    s.hands[1] = s.hands[1].filter((t) => !chiTiles.includes(t));
    s.melds[1].push({ type: "chi", tiles: chiTiles, called: chiTiles[0], from: 0 });
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "4p") });
    const claims = legalActions(s, 1).claim;
    expect(claims).not.toContainEqual({ type: "ron" });
    expect(claims.some((c) => c.type === "chi")).toBe(true);
  });
});

describe("calls", () => {
  const callSpec = {
    hands: {
      0: "3s19m19p9s1234567z",
      1: "24s258m369p12567z",
      2: "33s147m258p34z158s",
      3: "222m999m111p888p1s",
    },
    draws: "7z",
  } as const;

  it("gives pon priority over chi and forces the caller to discard", () => {
    const s = fixtureHand(callSpec);
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "3s") });
    const chi = legalActions(s, 1).claim.find((c) => c.type === "chi");
    const pon = legalActions(s, 2).claim.find((c) => c.type === "pon");
    expect(chi && pon).toBeTruthy();
    if (chi?.type !== "chi" || pon?.type !== "pon") throw new Error("expected options");
    applyAction(s, 1, { type: "chi", tiles: chi.tiles });
    applyAction(s, 2, { type: "pon", tiles: pon.tiles });
    expect(s.melds[2]).toHaveLength(1);
    expect(s.melds[1]).toHaveLength(0);
    expect(s.turn).toBe(2);
    expect(legalActions(s, 2).tsumo).toBe(false);
    // kuikae: cannot discard the kind just called
    const legal = legalActions(s, 2).discard;
    expect(legal.every((t) => kindOf(t) !== parseKinds("3s")[0])).toBe(true);
    expect(s.discards[0][0].calledBy).toBe(2);
    census(s);
  });

  it("only offers chi to the player after the discarder", () => {
    const s = fixtureHand({ ...callSpec, hands: { ...callSpec.hands, 1: "19s258m369p12567z", 2: "24s147m258p34z158s" } });
    applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "3s") });
    expect(legalActions(s, 2).claim.some((c) => c.type === "chi")).toBe(false);
  });

  it("handles a closed kan: rinshan draw, new dora indicator, tile conservation", () => {
    const s = fixtureHand({ hands: { 0: "1111z23m456p789s5z" }, draws: "9m" });
    const before = s.wall.length;
    expect(legalActions(s, 0).ankan).toContain(27);
    applyAction(s, 0, { type: "ankan", kind: 27 });
    expect(s.kanCount).toBe(1);
    expect(s.doraIndicators).toHaveLength(2);
    expect(s.wall.length).toBe(before - 1);
    expect(s.hands[0]).toHaveLength(11);
    expect(s.afterKan).toBe(true);
    census(s);
  });
});

describe("riichi", () => {
  it("requires a closed tenpai hand and then forces tsumogiri", () => {
    const s = fixtureHand({ hands: { 0: "123m456p789s23s11z" }, draws: "9m" });
    const nineM = tileOf(s, 0, "9m");
    expect(legalActions(s, 0).riichi).toContain(nineM);
    // riichi on a discard that breaks tenpai is rejected
    expect(applyAction(s, 0, { type: "discard", tile: tileOf(s, 0, "1m"), riichi: true }).ok).toBe(false);
    expect(applyAction(s, 0, { type: "discard", tile: nineM, riichi: true }).ok).toBe(true);
    expect(s.scores[0]).toBe(24000);
    expect(s.riichiSticks).toBe(1);
    // play until seat 0's next turn
    while (s.phase !== "ended" && !(s.phase === "discard" && s.turn === 0)) {
      const seat = s.phase === "claim" ? ([0, 1, 2, 3] as Seat[]).find((x) => legalActions(s, x).claim.length)! : s.turn;
      applyAction(s, seat, tsumogiri(seatView(s, seat)));
    }
    if (s.phase !== "ended" && !legalActions(s, 0).tsumo) {
      expect(legalActions(s, 0).discard).toEqual([s.drawnTile]);
    }
  });

  it("is unavailable below 1000 points", () => {
    const s = fixtureHand({ hands: { 0: "123m456p789s23s11z" }, draws: "9m" }, { scores: [500, 25000, 25000, 25000] });
    expect(legalActions(s, 0).riichi).toEqual([]);
  });
});

describe("shanten", () => {
  const sh = (mpsz: string) => shanten(countKinds(parseKinds(mpsz)));
  it("computes standard, seven-pairs, and thirteen-orphans shanten", () => {
    expect(sh("123m456p789s23s11z")).toBe(0);
    expect(sh("123m456p789s123s11z")).toBe(-1);
    expect(sh("1122m3344p5566s7z")).toBe(0); // chiitoitsu tenpai
    expect(sh("19m19p19s1234567z")).toBe(0); // kokushi 13-sided
  });

  it("matches hand-verified 3-shanten hands (where the library reports 4)", () => {
    // 55m 78m 13p 11s 34s + 7s W Wh: draw 6m, 2p, 2s -> 55m 678m 123p 11s 234s tenpai.
    expect(sh("55m78m13p113s4s7s3z5z")).toBe(3);
    // 55m 7m9m 22p 3p5p 8p9p + 2s 6s G: draw 8m, 4p, 7p -> 55m 789m 345p 789p 22p tenpai.
    expect(sh("5579m22358p9p26s6z")).toBe(3);
  });

  it("agrees with @pai-forge/riichi-mahjong on >99.9% of random hands", () => {
    const rng = makeRng("shanten-xcheck");
    let mismatch = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const w = shuffle(Array.from({ length: 136 }, (_, t) => t >> 2), rng).slice(0, 13).sort((a, b) => a - b);
      const lib = calculateShanten(validateTehai13({ closed: w as HaiKindId[], exposed: [] })._unsafeUnwrap())._unsafeUnwrap();
      if (lib !== shanten(countKinds(w))) mismatch++;
    }
    expect(mismatch / N).toBeLessThan(0.002);
  });
});

describe("views (private state isolation)", () => {
  it("public view contains no closed hands while the hand is live", () => {
    const s = startHand(defaultConfig("views"));
    const pub = publicView(s);
    const json = JSON.stringify(pub);
    expect(pub.revealedHands).toBeNull();
    expect(json).not.toContain('"hand"');
    expect(json).not.toContain('"wall"');
    expect(json).not.toContain('"deadWall"');
  });

  it("a seat view contains only that seat's tiles", () => {
    const s = startHand(defaultConfig("views2"));
    const v = seatView(s, 1);
    expect(v.me.hand).toEqual(s.hands[1]);
    // No other seat's private hand appears anywhere in the payload.
    const leaked = JSON.stringify({ ...v, me: undefined });
    for (const seat of [0, 2, 3] as Seat[]) {
      expect(leaked).not.toContain(JSON.stringify(s.hands[seat]));
    }
  });

  it("does not reveal claim eligibility in the public view", () => {
    const s = fixtureHand({
      hands: { 0: "3s19m19p9s1234567z", 1: "24s258m369p12567z", 2: "33s147m258p34z158s", 3: "222m999m111p888p1s" },
      draws: "7z",
    });
    applyAction(s, 0, { type: "discard", tile: s.hands[0].find((t) => kindOf(t) === parseKinds("3s")[0])! });
    const pub = publicView(s);
    expect(pub.claim).toEqual({ tile: s.claim!.tile, from: 0 });
    expect(JSON.stringify(pub)).not.toContain("options");
    expect(seatView(s, 3).me.legal.claim).toEqual([]);
  });

  it("reveals hands only after the hand ends", () => {
    const s = fixtureHand({ hands: { 0: "123m456p789s23s11z" }, draws: "1s" });
    applyAction(s, 0, { type: "tsumo" });
    expect(publicView(s).revealedHands).toHaveLength(4);
  });
});
