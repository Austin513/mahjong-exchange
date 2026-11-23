// Private-information model for one seat: combines the public model's probability for
// that seat with the seat's own shanten/ukeire (binary logistic, fitted on self-play).
// Used by informed trading bots attached to bot-controlled seats — never by the house.

import coefficients from "./coefficients.json";
import type { PrivateSeatFeatures } from "./dataset";

export const INFORMED_FEATURES = ["intercept", "publicLogit", "tenpai", "oneShanten", "liveOutsTenpai", "liveOuts", "progress", "progressTenpai"] as const;

const W: number[] = (coefficients as { informed?: number[] }).informed ?? INFORMED_FEATURES.map((_, i) => (i === 1 ? 1 : 0));

const logit = (p: number) => Math.log(Math.max(1e-4, p) / Math.max(1e-4, 1 - p));

export function informedRow(pPublic: number, priv: PrivateSeatFeatures, progress: number): number[] {
  const tenpai = priv.shanten <= 0 ? 1 : 0;
  return [1, logit(pPublic), tenpai, priv.shanten === 1 ? 1 : 0, tenpai * Math.min(priv.ukeire, 16) / 8, Math.min(priv.ukeire, 40) / 20, progress, progress * tenpai];
}

export function informedSeatProbability(pPublic: number, priv: PrivateSeatFeatures, progress: number, w: number[] = W): number {
  const z = informedRow(pPublic, priv, progress).reduce((s, x, i) => s + x * w[i], 0);
  return 1 / (1 + Math.exp(-z));
}

/**
 * Full five-outcome distribution for an informed trader at `seat`: its own seat gets the
 * private estimate, the other outcomes keep their public proportions.
 */
export function informedDistribution(pub: number[], seat: number, priv: PrivateSeatFeatures, progress: number): number[] {
  const q = Math.min(0.97, Math.max(0.005, informedSeatProbability(pub[seat], priv, progress)));
  const rest = 1 - pub[seat];
  return pub.map((p, i) => (i === seat ? q : rest > 0 ? (p * (1 - q)) / rest : (1 - q) / 4));
}
