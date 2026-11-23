// Measures table-bot strength on seeded hands. One "hero" policy sits with three copies
// of a baseline; the hero's seat and the dealer rotate. Reports win share, deal-in rate,
// and draws. Usage: npx tsx scripts/bot-eval.ts [hands=200]

import { defaultConfig, makePolicy, playHand, type PolicyName } from "../src/bots/mahjong/runner";
import type { Seat } from "../src/engine/tiles";

const N = Number(process.argv[2] ?? 200);

function match(hero: PolicyName, base: PolicyName, n: number) {
  let heroWins = 0, baseWins = 0, draws = 0, heroDealIns = 0, baseDealIns = 0;
  for (let i = 0; i < n; i++) {
    const heroSeat = (i % 4) as Seat;
    const pols = [0, 1, 2, 3].map((s) => makePolicy(s === heroSeat ? hero : base, `eval-${i}-${s}`));
    const s = playHand(defaultConfig(`bot-eval-${i}`, 1, (Math.floor(i / 4) % 4) as Seat), pols);
    const r = s.result!;
    if (r.type === "draw") draws++;
    else {
      if (r.winner === heroSeat) heroWins++;
      else baseWins++;
      if (r.from === heroSeat) heroDealIns++;
      else if (r.from !== null) baseDealIns++;
    }
  }
  const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
  return {
    matchup: `${hero} vs 3x ${base}`,
    hands: n,
    heroWin: pct(heroWins),
    baselineWinPerSeat: pct(baseWins / 3),
    draws: pct(draws),
    heroDealIn: pct(heroDealIns),
    baselineDealInPerSeat: pct(baseDealIns / 3),
  };
}

const t0 = Date.now();
const rows = [match("smart", "random", Math.min(N, 100)), match("greedy", "random", Math.min(N, 100)), match("smart", "greedy", N)];
console.table(rows);
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s; fair share at a 4-seat table is 25% minus draws)`);
