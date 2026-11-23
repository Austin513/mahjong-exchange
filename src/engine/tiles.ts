// Tile model. Physical tiles are ids 0..135. A tile's kind is `id >> 2` (0..33):
// 0-8 = 1-9 man (characters), 9-17 = 1-9 pin (dots), 18-26 = 1-9 sou (bamboo),
// 27-30 = East/South/West/North, 31-33 = White/Green/Red dragons. No red fives.

export type TileId = number;
export type TileKind = number;
export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export const TILE_COUNT = 136;
export const KIND_COUNT = 34;
export const EAST = 27;

export const kindOf = (t: TileId): TileKind => t >> 2;
export const isHonor = (k: TileKind): boolean => k >= 27;
export const isDragon = (k: TileKind): boolean => k >= 31;
export const isWind = (k: TileKind): boolean => k >= 27 && k <= 30;
export const suitOf = (k: TileKind): number => (k < 27 ? Math.floor(k / 9) : 3);
export const rankOf = (k: TileKind): number => (k < 27 ? (k % 9) + 1 : 0);
export const isTerminal = (k: TileKind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k: TileKind): boolean => isHonor(k) || isTerminal(k);
export const isSimple = (k: TileKind): boolean => !isYaochu(k);

export const nextSeat = (s: Seat, n = 1): Seat => (((s + n) % 4) + 4) % 4 as Seat;

/** The tile kind that a dora indicator points at. */
export function doraFromIndicator(k: TileKind): TileKind {
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k <= 30) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

const SUIT_CHAR = ["m", "p", "s"];
const HONOR_NAMES = ["E", "S", "W", "N", "Wh", "G", "R"];

/** Short label, e.g. "5p", "E", "R". Used in logs, tests, and the UI. */
export function kindLabel(k: TileKind): string {
  return k < 27 ? `${rankOf(k)}${SUIT_CHAR[suitOf(k)]}` : HONOR_NAMES[k - 27];
}

/** Seat wind tile kind for `seat` when `dealer` is East. */
export const seatWind = (seat: Seat, dealer: Seat): TileKind => EAST + ((seat - dealer + 4) % 4);

/**
 * Parse mpsz notation ("123m456p11z") into kinds. 1z-7z = E S W N Wh G R.
 * Test/fixture helper only.
 */
export function parseKinds(s: string): TileKind[] {
  const out: TileKind[] = [];
  let digits: number[] = [];
  for (const ch of s.replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") digits.push(Number(ch));
    else {
      const base = { m: 0, p: 9, s: 18, z: 27 }[ch];
      if (base === undefined) throw new Error(`bad mpsz char ${ch}`);
      for (const d of digits) out.push(base + d - 1);
      digits = [];
    }
  }
  if (digits.length) throw new Error("dangling digits in mpsz");
  return out;
}

export function countKinds(kinds: readonly TileKind[]): number[] {
  const c = Array.from({ length: KIND_COUNT }, () => 0);
  for (const k of kinds) c[k]++;
  return c;
}

export const kindsOf = (tiles: readonly TileId[]): TileKind[] => tiles.map(kindOf);

export const sortTiles = (tiles: TileId[]): TileId[] => tiles.sort((a, b) => a - b);
