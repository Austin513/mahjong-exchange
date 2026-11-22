// Conditional multinomial logit over the five outcomes (4 seats + draw).
//   u_seat_i = β · x_i   (β shared across seats → seat-symmetric)
//   u_draw   = γ · z
//   p = softmax(u)       → five probabilities that sum to one by construction.
// Coefficients are fitted by scripts/fit-model.ts on bot self-play and checked in.

import coefficients from "./coefficients.json";
import { DRAW_FEATURES, SEAT_FEATURES, extractFeatures, type OutcomeFeatures } from "./features";
import type { PublicTableView } from "../engine/views";

export interface ModelParams {
  beta: number[];
  gamma: number[];
}

export const FITTED: ModelParams = coefficients as ModelParams;
if (FITTED.beta.length !== SEAT_FEATURES.length || FITTED.gamma.length !== DRAW_FEATURES.length) {
  throw new Error("coefficients.json does not match the feature definitions; rerun npm run fit-model");
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export function probabilitiesFromFeatures(f: OutcomeFeatures, p: ModelParams = FITTED): number[] {
  const u = [...f.seats.map((x) => dot(x, p.beta)), dot(f.draw, p.gamma)];
  const m = Math.max(...u);
  const e = u.map((x) => Math.exp(x - m));
  const z = e.reduce((s, x) => s + x, 0);
  return e.map((x) => x / z);
}

/** [P(seat0), P(seat1), P(seat2), P(seat3), P(draw)] from public information only. */
export function outcomeProbabilities(v: PublicTableView, p: ModelParams = FITTED): number[] {
  return probabilitiesFromFeatures(extractFeatures(v), p);
}
