// Random legal baseline: uniform over every legal choice (each discard tile, each
// riichi discard, tsumo, kans, each claim option, pass). Seedable for experiments.

import type { Action } from "../../engine/types";
import type { SeatView } from "../../engine/views";
import { pick, type Rng } from "../../engine/rng";

export function randomAction(v: SeatView, rng: Rng): Action {
  const l = v.me.legal;
  const choices: Action[] = [];
  if (l.claim.length > 0) {
    choices.push({ type: "pass" });
    for (const o of l.claim) choices.push(o.type === "ron" || o.type === "minkan" ? { type: o.type } : { type: o.type, tiles: o.tiles });
    return pick(rng, choices);
  }
  for (const t of l.discard) choices.push({ type: "discard", tile: t });
  for (const t of l.riichi) choices.push({ type: "discard", tile: t, riichi: true });
  if (l.tsumo) choices.push({ type: "tsumo" });
  for (const k of l.ankan) choices.push({ type: "ankan", kind: k });
  for (const k of l.kakan) choices.push({ type: "kakan", kind: k });
  return choices.length ? pick(rng, choices) : { type: "pass" };
}
