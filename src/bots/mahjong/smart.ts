// Smart table bot. Input: a SeatView (own tiles + public table) and nothing else.
//
// Offense: minimise shanten; break ties by ukeire counted against tiles still unseen
// from this seat's perspective; then discard the least useful tile (isolated honors
// and terminals first, keep dora). Riichi when closed and tenpai with live waits.
// Calls: pon yakuhai; other calls only when the hand already has a yakuhai meld or
// stays all-simples (tanyao) and the call strictly lowers shanten.
// Defense: when an opponent is in riichi and we are not close (shanten >= 2, or
// 1-shanten with few outs), discard the safest tile (genbutsu > tiles passed since the
// riichi > honors with many visible > suji > terminals > the rest).

import type { Action, ClaimOption } from "../../engine/types";
import type { SeatView } from "../../engine/views";
import { shanten, ukeire } from "../../engine/shanten";
import {
  countKinds,
  doraFromIndicator,
  EAST,
  isDragon,
  isHonor,
  isSimple,
  isTerminal,
  isYaochu,
  KIND_COUNT,
  kindOf,
  type Seat,
  type TileId,
  type TileKind,
} from "../../engine/tiles";

export interface SmartOptions {
  /** Disable ukeire tie-breaks, calls, riichi judgement, and defense (ablation baseline). */
  greedyOnly?: boolean;
}

/** Tiles this seat can see outside its own hand. */
export function visibleCounts(v: SeatView): number[] {
  const c = Array.from({ length: KIND_COUNT }, () => 0);
  for (const s of v.seats) {
    for (const d of s.discards) if (d.calledBy === null) c[kindOf(d.tile)]++;
    for (const m of s.melds) for (const t of m.tiles) c[kindOf(t)]++;
  }
  for (const t of v.doraIndicators) c[kindOf(t)]++;
  return c;
}

const yakuhaiKinds = (v: SeatView): Set<TileKind> =>
  new Set([31, 32, 33, v.roundWind, v.seats[v.me.seat].wind]);

const meldCount = (v: SeatView) => v.seats[v.me.seat].melds.length;

interface DiscardEval {
  tile: TileId;
  shanten: number;
  ukeire: number;
}

function evalDiscards(v: SeatView, candidates: TileId[], visible: number[], withUkeire: boolean): DiscardEval[] {
  const c = countKinds(v.me.hand.map(kindOf));
  const mc = meldCount(v);
  const byKind = new Map<TileKind, DiscardEval>();
  for (const t of candidates) {
    const k = kindOf(t);
    if (byKind.has(k)) continue;
    c[k]--;
    byKind.set(k, { tile: t, shanten: shanten(c, mc), ukeire: 0 });
    c[k]++;
  }
  const evals = [...byKind.values()];
  const best = Math.min(...evals.map((e) => e.shanten));
  if (withUkeire) {
    for (const e of evals) {
      if (e.shanten > best + 0) continue;
      const k = kindOf(e.tile);
      c[k]--;
      e.ukeire = ukeire(c, mc, visible).count;
      c[k]++;
    }
  }
  return evals;
}

/** Lower = better to throw away. Used to break efficiency ties. */
function keepValue(v: SeatView, k: TileKind, counts: number[]): number {
  const doras = v.doraIndicators.map((t) => doraFromIndicator(kindOf(t)));
  let val = 0;
  if (doras.includes(k)) val += 3;
  if (isHonor(k)) {
    val += yakuhaiKinds(v).has(k) ? (counts[k] >= 2 ? 4 : 1) : counts[k] >= 2 ? 2 : -1;
  } else {
    const r = k % 9;
    val += isTerminal(k) ? 0 : r === 1 || r === 7 ? 1 : 2;
    for (const d of [-2, -1, 1, 2]) {
      const n = k + d;
      if (n >= 0 && n < 27 && Math.floor(n / 9) === Math.floor(k / 9) && counts[n] > 0) val += 1;
    }
  }
  return val;
}

// ------------------------------------------------------------------ defense

function threats(v: SeatView): Seat[] {
  return v.seats.filter((s) => s.seat !== v.me.seat && s.riichi).map((s) => s.seat);
}

/** Safety of discarding kind `k` against threat seat `t`. Higher = safer. */
export function safety(v: SeatView, t: Seat, k: TileKind, visible: number[]): number {
  const pile = v.seats[t].discards;
  if (pile.some((d) => kindOf(d.tile) === k)) return 100; // genbutsu (furiten)
  const riichiIdx = pile.findIndex((d) => d.riichi);
  // Tiles any seat discarded after the riichi without being ronned are safe now
  // (temporary/riichi furiten) — approximate by discards made after the riichi.
  if (riichiIdx >= 0) {
    const turnsSince = pile.length - riichiIdx;
    for (const s of v.seats) {
      const recent = s.discards.slice(Math.max(0, s.discards.length - turnsSince));
      if (s.seat !== t && recent.some((d) => kindOf(d.tile) === k)) return 90;
    }
  }
  if (isHonor(k)) return visible[k] >= 3 ? 85 : visible[k] === 2 ? 65 : 40;
  const r = k % 9;
  const has = (rr: number) => pile.some((d) => kindOf(d.tile) === k - r + rr);
  const lowSuji = r >= 3 ? has(r - 3) : true;
  const highSuji = r <= 5 ? has(r + 3) : true;
  if (lowSuji && highSuji) return isTerminal(k) ? 60 : 50;
  if (lowSuji || highSuji) return isTerminal(k) ? 35 : 25;
  return isTerminal(k) ? 20 : r === 1 || r === 7 ? 10 : 0;
}

// ------------------------------------------------------------------ main policy

export function chooseAction(v: SeatView, opts: SmartOptions = {}): Action {
  const legal = v.me.legal;
  if (legal.claim.length > 0) return chooseClaim(v, legal.claim, opts);
  if (legal.tsumo) return { type: "tsumo" };
  if (legal.discard.length === 0) return { type: "pass" };

  const visible = visibleCounts(v);
  const greedy = opts.greedyOnly === true;
  const evals = evalDiscards(v, legal.discard, visible, !greedy);
  const bestShanten = Math.min(...evals.map((e) => e.shanten));
  const counts = countKinds(v.me.hand.map(kindOf));

  // Kans that don't hurt the hand.
  if (!greedy && threats(v).length === 0) {
    for (const k of legal.ankan) {
      const c = [...counts]; c[k] -= 4;
      if (shanten(c, meldCount(v) + 1) <= bestShanten) return { type: "ankan", kind: k };
    }
    for (const k of legal.kakan) {
      const c = [...counts]; c[k] -= 1;
      if (shanten(c, meldCount(v)) <= bestShanten) return { type: "kakan", kind: k };
    }
  }

  // Riichi: pick the riichi discard with the most live waits.
  if (legal.riichi.length > 0) {
    const options = evalDiscards(v, legal.riichi, visible, true).filter((e) => e.shanten === 0);
    options.sort((a, b) => b.ukeire - a.ukeire);
    if (options.length && (greedy || options[0].ukeire >= 1)) return { type: "discard", tile: options[0].tile, riichi: true };
  }

  // Defense against riichi.
  const th = threats(v);
  if (!greedy && th.length > 0) {
    const bestUke = Math.max(...evals.filter((e) => e.shanten === bestShanten).map((e) => e.ukeire));
    const pushing = bestShanten === 0 || (bestShanten === 1 && bestUke >= 12);
    if (!pushing) {
      const scored = evals.map((e) => ({ e, safe: Math.min(...th.map((t) => safety(v, t, kindOf(e.tile), visible))) }));
      scored.sort((a, b) => b.safe - a.safe || a.e.shanten - b.e.shanten || b.e.ukeire - a.e.ukeire);
      return { type: "discard", tile: scored[0].e.tile };
    }
  }

  const tanyaoPlan = !greedy && meldCount(v) > 0 && v.seats[v.me.seat].melds.every((m) => m.tiles.every((t) => isSimple(kindOf(t))));
  const sorted = evals
    .filter((e) => e.shanten === bestShanten)
    .sort((a, b) => {
      if (!greedy && b.ukeire !== a.ukeire) return b.ukeire - a.ukeire;
      const ka = kindOf(a.tile), kb = kindOf(b.tile);
      const va = keepValue(v, ka, counts) - (tanyaoPlan && isYaochu(ka) ? 5 : 0);
      const vb = keepValue(v, kb, counts) - (tanyaoPlan && isYaochu(kb) ? 5 : 0);
      return greedy ? a.tile - b.tile : va - vb;
    });
  return { type: "discard", tile: sorted[0].tile };
}

function chooseClaim(v: SeatView, options: ClaimOption[], opts: SmartOptions): Action {
  if (options.some((o) => o.type === "ron")) return { type: "ron" };
  if (opts.greedyOnly) return { type: "pass" };
  const claimTile = v.claim?.tile;
  if (claimTile === undefined) return { type: "pass" };
  const k = kindOf(claimTile);
  const counts = countKinds(v.me.hand.map(kindOf));
  const mc = meldCount(v);
  const current = shanten(counts, mc);
  if (current === 0 && mc === 0) return { type: "pass" }; // keep closed tenpai
  if (threats(v).length > 0 && current >= 2) return { type: "pass" };

  const yakuhai = yakuhaiKinds(v);
  const melds = v.seats[v.me.seat].melds;
  const hasYakuhaiMeld = melds.some((m) => isHonor(kindOf(m.tiles[0])) && yakuhai.has(kindOf(m.tiles[0])));
  const closedYaochu = v.me.hand.filter((t) => isYaochu(kindOf(t))).length;

  let best: { action: Action; after: number } | null = null;
  for (const o of options) {
    if (o.type !== "pon" && o.type !== "chi") continue;
    const meldKinds = [...o.tiles.map(kindOf), k];
    const c = [...counts];
    for (const mk of o.tiles.map(kindOf)) c[mk]--;
    // After the call we discard one tile: best achievable shanten.
    let after = 99;
    for (let d = 0; d < KIND_COUNT; d++) {
      if (c[d] === 0 || d === k) continue;
      c[d]--;
      after = Math.min(after, shanten(c, mc + 1));
      c[d]++;
    }
    const isYakuhaiPon = o.type === "pon" && yakuhai.has(k) && (isDragon(k) || k >= EAST);
    const tanyaoOk = meldKinds.every(isSimple) && melds.every((m) => m.tiles.every((t) => isSimple(kindOf(t)))) && closedYaochu <= 2;
    const allowed = isYakuhaiPon ? after <= current : (hasYakuhaiMeld || tanyaoOk) && after < current;
    if (allowed && (!best || after < best.after)) best = { action: { type: o.type, tiles: o.tiles }, after };
  }
  return best ? best.action : { type: "pass" };
}
