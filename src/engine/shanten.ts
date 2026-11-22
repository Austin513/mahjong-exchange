// Fast shanten / waits / ukeire on kind-count vectors. Works for 3n+1 and 3n+2 closed
// tiles with `meldCount` exposed (or closed-kan) sets. Cross-checked against
// @pai-forge/riichi-mahjong in tests. Shanten -1 means the hand is complete.

import { KIND_COUNT, isYaochu } from "./tiles";

function regularShanten(c: number[], meldCount: number): number {
  let best = 8;
  const dfs = (i: number, mentsu: number, taatsu: number, pair: number): void => {
    while (i < KIND_COUNT && c[i] === 0) i++;
    if (i >= KIND_COUNT) {
      const t = Math.min(taatsu, 4 - mentsu);
      const s = 8 - 2 * mentsu - t - pair;
      if (s < best) best = s;
      return;
    }
    const suited = i < 27;
    const pos = i % 9;
    if (c[i] >= 3) {
      c[i] -= 3; dfs(i, mentsu + 1, taatsu, pair); c[i] += 3;
    }
    if (suited && pos <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, mentsu + 1, taatsu, pair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) dfs(i, mentsu, taatsu, 1);
      dfs(i, mentsu, taatsu + 1, pair);
      c[i] += 2;
    }
    if (suited && pos <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--; dfs(i, mentsu, taatsu + 1, pair); c[i]++; c[i + 1]++;
    }
    if (suited && pos <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--; dfs(i, mentsu, taatsu + 1, pair); c[i]++; c[i + 2]++;
    }
    // Treat one copy as isolated.
    c[i]--; dfs(i, mentsu, taatsu, pair); c[i]++;
  };
  dfs(0, meldCount, 0, 0);
  return best;
}

function chiitoiShanten(c: number[]): number {
  let pairs = 0, kinds = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] > 0) kinds++;
    if (c[k] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

function kokushiShanten(c: number[]): number {
  let kinds = 0, pair = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!isYaochu(k)) continue;
    if (c[k] > 0) kinds++;
    if (c[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

/** Shanten of a closed-tile count vector. Mutates `c` temporarily; restores it. */
export function shanten(c: number[], meldCount = 0): number {
  let s = regularShanten(c, meldCount);
  if (meldCount === 0) s = Math.min(s, chiitoiShanten(c), kokushiShanten(c));
  return s;
}

/** Kinds that complete a tenpai 13-tile hand (ignores how many copies remain). */
export function waits(c: number[], meldCount = 0): number[] {
  const out: number[] = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, meldCount) === -1) out.push(k);
    c[k]--;
  }
  return out;
}

/**
 * Useful draws for a 3n+1 hand: kinds that reduce shanten, with the number of copies
 * still unseen from the holder's perspective (`visible` counts tiles the holder can see
 * outside its hand: discards, melds, dora indicators).
 */
export function ukeire(c: number[], meldCount: number, visible: readonly number[]) {
  const base = shanten(c, meldCount);
  const kinds: number[] = [];
  let count = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    const s = shanten(c, meldCount);
    c[k]--;
    if (s < base) {
      kinds.push(k);
      count += Math.max(0, 4 - c[k] - visible[k]);
    }
  }
  return { shanten: base, kinds, count };
}
