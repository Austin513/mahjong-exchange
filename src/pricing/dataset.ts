// Self-play snapshots for fitting and validating outcome models. One snapshot after
// every discard (all seats then hold 3n+1 tiles). Public part = PublicTableView;
// private part = each seat's shanten/ukeire, used only to fit the informed model.

import { playHand, defaultConfig, makePolicy } from "../bots/mahjong/runner";
import { countKinds, kindOf, type Seat } from "../engine/tiles";
import { ukeire } from "../engine/shanten";
import { publicView, type PublicTableView } from "../engine/views";
import type { HandState, Outcome } from "../engine/types";
import { outcomeOf } from "../engine/game";

export interface PrivateSeatFeatures {
  shanten: number;
  ukeire: number;
}

export interface Snapshot {
  pub: PublicTableView;
  priv: PrivateSeatFeatures[];
}

export interface HandRecord {
  seed: string;
  snapshots: Snapshot[];
  outcome: Outcome;
}

/** Visible-from-a-seat tile counts using only public info (discards, melds, indicators). */
export function publicVisibleCounts(v: PublicTableView): number[] {
  const c = Array.from({ length: 34 }, () => 0);
  for (const s of v.seats) {
    for (const d of s.discards) if (d.calledBy === null) c[kindOf(d.tile)]++;
    for (const m of s.melds) for (const t of m.tiles) c[kindOf(t)]++;
  }
  for (const t of v.doraIndicators) c[kindOf(t)]++;
  return c;
}

export function privateFeatures(hand: number[], meldCount: number, pub: PublicTableView): PrivateSeatFeatures {
  const counts = countKinds(hand.map(kindOf));
  if (hand.length % 3 !== 1) return { shanten: 8, ukeire: 0 };
  const u = ukeire(counts, meldCount, publicVisibleCounts(pub));
  return { shanten: u.shanten, ukeire: u.count };
}

export function snapshotOf(s: HandState): Snapshot {
  const pub = publicView(s);
  const priv = ([0, 1, 2, 3] as Seat[]).map((seat) => privateFeatures(s.hands[seat], s.melds[seat].length, pub));
  return { pub, priv };
}

export const outcomeIndex = (o: Outcome): number => (o === "draw" ? 4 : o);

export function generateHands(seedPrefix: string, count: number, startIndex = 0): HandRecord[] {
  const out: HandRecord[] = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    const seed = `${seedPrefix}-${i}`;
    const snapshots: Snapshot[] = [];
    let lastDiscards = 0;
    const pols = [0, 1, 2, 3].map(() => makePolicy("smart"));
    const s = playHand(defaultConfig(seed, 1 + (i % 8), (i % 4) as Seat), pols, {
      onStep: (st) => {
        const n = st.discards.reduce((a, d) => a + d.length, 0);
        if (n !== lastDiscards && st.phase !== "ended") {
          lastDiscards = n;
          snapshots.push(snapshotOf(st));
        }
      },
    });
    out.push({ seed, snapshots, outcome: outcomeOf(s)! });
  }
  return out;
}
