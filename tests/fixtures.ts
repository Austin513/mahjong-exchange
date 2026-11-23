// Fixture walls: specify starting hands (mpsz) and the live draw order; every other
// tile is filled deterministically. Lets tests replay exact scenarios.

import { parseKinds, type Seat, type TileId, TILE_COUNT, nextSeat } from "../src/engine/tiles";
import { startHand } from "../src/engine/game";
import { makeRng, shuffle } from "../src/engine/rng";
import type { HandConfig, HandState } from "../src/engine/types";
import { EAST } from "../src/engine/tiles";

export interface FixtureSpec {
  dealer?: Seat;
  /** Starting 13-tile hands indexed by seat (mpsz). Omitted seats get filler. */
  hands: Partial<Record<Seat, string>>;
  /** Live-wall draws in order (mpsz), starting with the dealer's 14th tile. */
  draws?: string;
  /** Dora indicator kind (mpsz, one tile). */
  dora?: string;
}

export function fixtureWall(spec: FixtureSpec): TileId[] {
  const dealer = spec.dealer ?? 0;
  const pool = new Map<number, TileId[]>();
  for (let t = 0; t < TILE_COUNT; t++) {
    const k = t >> 2;
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(t);
  }
  const take = (k: number): TileId => {
    const arr = pool.get(k)!;
    if (!arr.length) throw new Error(`fixture uses kind ${k} more than 4 times`);
    return arr.shift()!;
  };
  const hands: (TileId[] | null)[] = [0, 1, 2, 3].map((s) => {
    const h = spec.hands[s as Seat];
    if (!h) return null;
    const kinds = parseKinds(h);
    if (kinds.length !== 13) throw new Error(`seat ${s} fixture hand must have 13 tiles`);
    return kinds.map(take);
  });
  const draws = parseKinds(spec.draws ?? "").map(take);
  const doraInd = spec.dora ? take(parseKinds(spec.dora)[0]) : null;
  // Filler: remaining tiles in a fixed shuffled order. Tests that care about every
  // seat specify all four hands.
  const rest: TileId[] = [];
  for (const k of [...pool.keys()].sort((a, b) => a - b)) rest.push(...pool.get(k)!);
  shuffle(rest, makeRng("fixture-filler"));
  const filler = () => rest.shift()!;
  for (let s = 0; s < 4; s++) if (!hands[s]) hands[s] = Array.from({ length: 13 }, filler);

  const wall: TileId[] = [];
  for (let r = 0; r < 13; r++) for (let i = 0; i < 4; i++) wall.push(hands[nextSeat(dealer, i)]![r]);
  wall.push(...draws);
  // Dead wall = last 14 tiles of the array, with the dora indicator at position 4.
  const dead: TileId[] = [];
  for (let i = 0; i < 14; i++) dead.push(i === 4 && doraInd !== null ? doraInd : rest.pop()!);
  wall.push(...rest.splice(0));
  return [...wall, ...dead];
}

export function fixtureHand(spec: FixtureSpec, overrides: Partial<HandConfig> = {}): HandState {
  const config: HandConfig = {
    seed: "fixture",
    handNumber: 1,
    dealer: spec.dealer ?? 0,
    roundWind: EAST,
    scores: [25000, 25000, 25000, 25000],
    riichiSticks: 0,
    ...overrides,
  };
  return startHand(config, fixtureWall(spec));
}
