// Fits the public outcome model (conditional logit) and the informed seat model on
// smart-bot self-play, validates both on held-out seeds, and writes
// src/pricing/coefficients.json + docs/MODEL.md.
// Usage: npx tsx scripts/fit-model.ts [trainHands=1500] [holdoutHands=500]

import { writeFileSync } from "node:fs";
import { generateHands, outcomeIndex, type HandRecord } from "../src/pricing/dataset";
import { DRAW_FEATURES, SEAT_FEATURES, extractFeatures, type OutcomeFeatures } from "../src/pricing/features";
import { probabilitiesFromFeatures, type ModelParams } from "../src/pricing/model";
import { INFORMED_FEATURES, informedRow } from "../src/pricing/informed";

const N_TRAIN = Number(process.argv[2] ?? 1500);
const N_HOLD = Number(process.argv[3] ?? 500);

interface Row { f: OutcomeFeatures; y: number; hand: number }

function rows(hands: HandRecord[]): Row[] {
  const out: Row[] = [];
  hands.forEach((h, hi) => {
    for (const s of h.snapshots) out.push({ f: extractFeatures(s.pub), y: outcomeIndex(h.outcome), hand: hi });
  });
  return out;
}

/** Adam on mean negative log-likelihood. `mask` freezes parameters (for ablations). */
function fitLogit(data: Row[], mask?: { beta: boolean[]; gamma: boolean[] }, iters = 600): ModelParams {
  const nb = SEAT_FEATURES.length, ng = DRAW_FEATURES.length;
  const theta = Array.from({ length: nb + ng }, () => 0);
  const m = Array.from({ length: nb + ng }, () => 0), v = Array.from({ length: nb + ng }, () => 0);
  const lr = 0.05, b1 = 0.9, b2 = 0.999, l2 = 1e-4;
  const free = [...(mask?.beta ?? Array.from({ length: nb }, () => true)), ...(mask?.gamma ?? Array.from({ length: ng }, () => true))];
  for (let it = 1; it <= iters; it++) {
    const g = Array.from({ length: nb + ng }, () => 0);
    const params = { beta: theta.slice(0, nb), gamma: theta.slice(nb) };
    for (const r of data) {
      const p = probabilitiesFromFeatures(r.f, params);
      for (let s = 0; s < 4; s++) {
        const resid = p[s] - (r.y === s ? 1 : 0);
        for (let k = 0; k < nb; k++) g[k] += resid * r.f.seats[s][k];
      }
      const rd = p[4] - (r.y === 4 ? 1 : 0);
      for (let k = 0; k < ng; k++) g[nb + k] += rd * r.f.draw[k];
    }
    for (let k = 0; k < nb + ng; k++) {
      if (!free[k]) continue;
      const grad = g[k] / data.length + l2 * theta[k];
      m[k] = b1 * m[k] + (1 - b1) * grad;
      v[k] = b2 * v[k] + (1 - b2) * grad * grad;
      theta[k] -= (lr * (m[k] / (1 - b1 ** it))) / (Math.sqrt(v[k] / (1 - b2 ** it)) + 1e-8);
    }
  }
  return { beta: theta.slice(0, nb).map(round4), gamma: theta.slice(nb).map(round4) };
}

function fitBinary(X: number[][], y: number[], iters = 800): number[] {
  const d = X[0].length;
  const w = Array.from({ length: d }, () => 0), m = Array.from({ length: d }, () => 0), v = Array.from({ length: d }, () => 0);
  for (let it = 1; it <= iters; it++) {
    const g = Array.from({ length: d }, () => 0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, x, k) => s + x * w[k], 0);
      const r = 1 / (1 + Math.exp(-z)) - y[i];
      for (let k = 0; k < d; k++) g[k] += r * X[i][k];
    }
    for (let k = 0; k < d; k++) {
      const grad = g[k] / X.length + 1e-4 * w[k];
      m[k] = 0.9 * m[k] + 0.1 * grad;
      v[k] = 0.999 * v[k] + 0.001 * grad * grad;
      w[k] -= (0.05 * (m[k] / (1 - 0.9 ** it))) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return w.map(round4);
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const ll = (p: number) => -Math.log(Math.max(1e-9, p));

function evaluate(data: Row[], predict: (r: Row) => number[]) {
  let logloss = 0, brier = 0;
  for (const r of data) {
    const p = predict(r);
    logloss += ll(p[r.y]);
    brier += p.reduce((s, x, i) => s + (x - (i === r.y ? 1 : 0)) ** 2, 0);
  }
  return { logloss: logloss / data.length, brier: brier / data.length };
}

function calibration(data: Row[], predict: (r: Row) => number[]) {
  const bins = [0, 0.1, 0.2, 0.3, 0.45, 0.6, 1.01];
  const acc = bins.slice(1).map(() => ({ n: 0, p: 0, hit: 0 }));
  for (const r of data) {
    const p = predict(r);
    for (let s = 0; s < 4; s++) {
      const b = bins.findIndex((x, i) => p[s] >= x && p[s] < bins[i + 1]);
      acc[b].n++;
      acc[b].p += p[s];
      acc[b].hit += r.y === s ? 1 : 0;
    }
  }
  return acc.map((a, i) => ({ bin: `${bins[i]}–${Math.min(1, bins[i + 1])}`, n: a.n, meanPredicted: a.n ? a.p / a.n : 0, observed: a.n ? a.hit / a.n : 0 }));
}

const t0 = Date.now();
console.log(`Generating ${N_TRAIN} training + ${N_HOLD} held-out self-play hands…`);
const train = generateHands("train", N_TRAIN);
const hold = generateHands("holdout", N_HOLD);
const trainRows = rows(train), holdRows = rows(hold);
console.log(`  ${trainRows.length} / ${holdRows.length} snapshots (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// Base rate: training outcome frequencies, seat-symmetric.
const drawRate = train.filter((h) => h.outcome === "draw").length / train.length;
const baseP = [0, 1, 2, 3].map(() => (1 - drawRate) / 4).concat(drawRate);

const nb = SEAT_FEATURES.length;
const timeOnlyMask = { beta: SEAT_FEATURES.map((f) => f === "intercept" || f === "dealer"), gamma: DRAW_FEATURES.map((f) => f !== "riichiCount") };
const timeOnly = fitLogit(trainRows, timeOnlyMask);
const full = fitLogit(trainRows);

const results = {
  baseRate: evaluate(holdRows, () => baseP),
  timeAndDealerOnly: evaluate(holdRows, (r) => probabilitiesFromFeatures(r.f, timeOnly)),
  fullPublicModel: evaluate(holdRows, (r) => probabilitiesFromFeatures(r.f, full)),
};
console.table(results);
const calib = calibration(holdRows, (r) => probabilitiesFromFeatures(r.f, full));
console.table(calib);

// Informed seat model: one row per (snapshot, seat).
function informedData(hands: HandRecord[]) {
  const X: number[][] = [], y: number[] = [], pubP: number[] = [];
  for (const h of hands) {
    for (const s of h.snapshots) {
      const p = probabilitiesFromFeatures(extractFeatures(s.pub), full);
      const progress = 1 - Math.min(1, s.pub.wallCount / 70);
      for (let seat = 0; seat < 4; seat++) {
        X.push(informedRow(p[seat], s.priv[seat], progress));
        y.push(h.outcome === seat ? 1 : 0);
        pubP.push(p[seat]);
      }
    }
  }
  return { X, y, pubP };
}
const it = informedData(train), ih = informedData(hold);
const informed = fitBinary(it.X, it.y);
const binLL = (ps: number[], ys: number[]) => ps.reduce((s, p, i) => s + (ys[i] ? ll(p) : ll(1 - p)), 0) / ps.length;
const informedP = ih.X.map((x) => 1 / (1 + Math.exp(-x.reduce((s, v, k) => s + v * informed[k], 0))));
const informedEval = { publicOnly: binLL(ih.pubP, ih.y), withPrivateHand: binLL(informedP, ih.y) };
console.table(informedEval);

writeFileSync("src/pricing/coefficients.json", JSON.stringify({ beta: full.beta, gamma: full.gamma, informed }, null, 2) + "\n");

const fmt = (x: number) => x.toFixed(4);
const md = `# Outcome model report (simulation)

Generated by \`npm run fit-model -- ${N_TRAIN} ${N_HOLD}\`. Training seeds \`train-0…${N_TRAIN - 1}\`, held-out seeds \`holdout-0…${N_HOLD - 1}\`.
The data is four smart table bots per hand (self-play), with one snapshot after every discard. That gives ${trainRows.length} training and ${holdRows.length} held-out snapshots.
Draw rate in training: ${(drawRate * 100).toFixed(1)}%.

## Public model (used by the house and public-information bots)
Conditional multinomial logit over {Seat A, Seat B, Seat C, Seat D, Draw}. Seat coefficients are shared across seats.

| seat feature | β |
|---|---|
${SEAT_FEATURES.map((f, i) => `| ${f} | ${full.beta[i]} |`).join("\n")}

| draw feature | γ |
|---|---|
${DRAW_FEATURES.map((f, i) => `| ${f} | ${full.gamma[i]} |`).join("\n")}

### Held-out performance (lower is better)
| model | log loss | Brier |
|---|---|---|
| base rate (seat-symmetric training frequencies) | ${fmt(results.baseRate.logloss)} | ${fmt(results.baseRate.brier)} |
| time + dealer only (ablation) | ${fmt(results.timeAndDealerOnly.logloss)} | ${fmt(results.timeAndDealerOnly.brier)} |
| full public model | ${fmt(results.fullPublicModel.logloss)} | ${fmt(results.fullPublicModel.brier)} |

### Calibration of seat-win probabilities (held-out)
| predicted bin | n | mean predicted | observed win rate |
|---|---|---|---|
${calib.map((c) => `| ${c.bin} | ${c.n} | ${fmt(c.meanPredicted)} | ${fmt(c.observed)} |`).join("\n")}

## Informed seat model (informed trading bots only)
Binary logistic for "this seat wins". Inputs are the public model's log-odds plus the seat's own shanten and live outs.

| feature | w |
|---|---|
${INFORMED_FEATURES.map((f, i) => `| ${f} | ${informed[i]} |`).join("\n")}

| held-out log loss (per seat-snapshot) | value |
|---|---|
| public model probability only | ${fmt(informedEval.publicOnly)} |
| with the seat's private hand | ${fmt(informedEval.withPrivateHand)} |

Caveats: the labels come from bot self-play, so the probabilities describe tables of smart bots. Humans
play differently. The model sees only public features: riichi, melds, discard counts, tsumogiri streaks
and the wall. It does not use tile-level reads (suji, dangerous tiles, dora visibility).
`;
writeFileSync("docs/MODEL.md", md);
console.log(`wrote src/pricing/coefficients.json and docs/MODEL.md in ${((Date.now() - t0) / 1000).toFixed(0)}s (nb=${nb})`);
