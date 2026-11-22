// Headless hand runner for tests, self-play data, and the experiment harness.
// Every decision goes through seatView + applyAction exactly like the live room.

import { actingSeats, applyAction, startHand } from "../../engine/game";
import { makeRng } from "../../engine/rng";
import type { Action, HandConfig, HandState } from "../../engine/types";
import { seatView, type SeatView } from "../../engine/views";
import { EAST, type Seat, type TileId } from "../../engine/tiles";
import { chooseAction } from "./smart";
import { randomAction } from "./random";

export type TablePolicy = (view: SeatView) => Action;
export type PolicyName = "smart" | "greedy" | "random";

export function makePolicy(name: PolicyName, seed = "policy"): TablePolicy {
  if (name === "smart") return (v) => chooseAction(v);
  if (name === "greedy") return (v) => chooseAction(v, { greedyOnly: true });
  const rng = makeRng(seed);
  return (v) => randomAction(v, rng);
}

export function defaultConfig(seed: string, handNumber = 1, dealer: Seat = 0): HandConfig {
  return { seed, handNumber, dealer, roundWind: EAST, scores: [25000, 25000, 25000, 25000], riichiSticks: 0 };
}

export function playHand(
  config: HandConfig,
  policies: TablePolicy[],
  opts: { presetWall?: TileId[]; onStep?: (s: HandState) => void } = {},
): HandState {
  const s = startHand(config, opts.presetWall);
  opts.onStep?.(s);
  for (let guard = 0; s.phase !== "ended"; guard++) {
    if (guard > 2000) throw new Error("hand did not terminate");
    const seat = actingSeats(s)[0];
    const action = policies[seat](seatView(s, seat));
    const r = applyAction(s, seat, action);
    if (!r.ok) throw new Error(`bot made illegal move ${JSON.stringify(action)}: ${r.error}`);
    opts.onStep?.(s);
  }
  return s;
}
