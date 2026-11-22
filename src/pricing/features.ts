// Observable features for the outcome model. Input is a PublicTableView only: the
// house (and public-information bots) can never see the wall or concealed tiles.

import type { PublicTableView } from "../engine/views";
import { kindOf } from "../engine/tiles";

/** Live tiles after the deal + dealer draw is 69; 70 normalises "fraction of wall left". */
const LIVE_WALL = 70;

export const SEAT_FEATURES = [
  "intercept",
  "dealer",
  "riichi",
  "riichiAge",
  "openMelds",
  "openMeldsLate",
  "yakuhaiMeld",
  "tsumogiriStreak",
  "othersRiichi",
] as const;
export const DRAW_FEATURES = ["progress", "nearEnd", "riichiCount"] as const;

export interface OutcomeFeatures {
  seats: number[][]; // 4 × SEAT_FEATURES.length
  draw: number[]; // DRAW_FEATURES.length
}

export function extractFeatures(v: PublicTableView): OutcomeFeatures {
  const progress = 1 - Math.min(1, v.wallCount / LIVE_WALL);
  const riichiCount = v.seats.filter((s) => s.riichi).length;
  const yakuhai = new Set([31, 32, 33, v.roundWind]);
  const seats = v.seats.map((s) => {
    const open = s.melds.filter((m) => m.type !== "ankan").length;
    const riichiIdx = s.discards.findIndex((d) => d.riichi);
    const riichiAge = riichiIdx < 0 ? 0 : Math.min(6, s.discards.length - 1 - riichiIdx) / 6;
    const yakuhaiMeld = s.melds.some((m) => m.type !== "chi" && (yakuhai.has(kindOf(m.tiles[0])) || kindOf(m.tiles[0]) === s.wind)) ? 1 : 0;
    let streak = 0;
    for (let i = s.discards.length - 1; i >= 0 && s.discards[i].tsumogiri && streak < 4; i--) streak++;
    return [
      1,
      v.dealer === s.seat ? 1 : 0,
      s.riichi ? 1 : 0,
      s.riichi ? riichiAge : 0,
      open,
      open * progress,
      yakuhaiMeld,
      streak / 4,
      riichiCount - (s.riichi ? 1 : 0),
    ];
  });
  return { seats, draw: [progress, 1 / (v.wallCount + 1), riichiCount] };
}
