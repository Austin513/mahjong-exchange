// Explicit projections of HandState. This is the privacy boundary: the server never
// serialises HandState; every outbound table payload and every bot input is built
// here. Private tiles appear only in the owning seat's view, and all hands are
// revealed only after the hand has ended (and the market has settled).

import { handWaits, legalActions } from "./game";
import type { DiscardEntry, HandResult, HandState, LegalActions, Meld } from "./types";
import { seatWind, type Seat, type TileId, type TileKind } from "./tiles";

export interface PublicSeat {
  seat: Seat;
  wind: TileKind;
  handCount: number;
  melds: Meld[];
  discards: DiscardEntry[];
  riichi: boolean;
  score: number;
}

export interface PublicTableView {
  handId: string;
  handNumber: number;
  version: number;
  dealer: Seat;
  roundWind: TileKind;
  phase: HandState["phase"];
  /** Whose discard turn it is (meaningful when phase === "discard"). */
  turn: Seat;
  wallCount: number;
  doraIndicators: TileId[];
  riichiSticks: number;
  seats: PublicSeat[];
  /** Open claim window: which tile, from whom. Deliberately omits who is eligible. */
  claim: { tile: TileId; from: Seat } | null;
  result: HandResult | null;
  /** All four hands, present only after the hand is over. */
  revealedHands: TileId[][] | null;
}

export interface PrivateSeatInfo {
  seat: Seat;
  hand: TileId[];
  drawnTile: TileId | null;
  legal: LegalActions;
  /** Wait kinds when the 13-tile hand is tenpai (UI helper). */
  waits: TileKind[];
  furiten: boolean;
}

export interface SeatView extends PublicTableView {
  me: PrivateSeatInfo;
}

const cloneMeld = (m: Meld): Meld => ({ ...m, tiles: [...m.tiles] });

export function publicView(s: HandState): PublicTableView {
  const ended = s.phase === "ended";
  return {
    handId: s.handId,
    handNumber: s.config.handNumber,
    version: s.version,
    dealer: s.config.dealer,
    roundWind: s.config.roundWind,
    phase: s.phase,
    turn: s.turn,
    wallCount: s.wall.length,
    doraIndicators: [...s.doraIndicators],
    riichiSticks: s.riichiSticks,
    seats: ([0, 1, 2, 3] as Seat[]).map((seat) => ({
      seat,
      wind: seatWind(seat, s.config.dealer),
      handCount: s.hands[seat].length,
      melds: s.melds[seat].map(cloneMeld),
      discards: s.discards[seat].map((d) => ({ ...d })),
      riichi: s.riichi[seat] !== null,
      score: s.scores[seat],
    })),
    claim: s.phase === "claim" && s.claim ? { tile: s.claim.tile, from: s.claim.from } : null,
    result: s.result ? structuredClone(s.result) : null,
    revealedHands: ended ? s.hands.map((h) => [...h]) : null,
  };
}

export function privateInfo(s: HandState, seat: Seat): PrivateSeatInfo {
  const hand = [...s.hands[seat]];
  const tenpaiCheck = hand.length % 3 === 1 && s.phase !== "ended";
  const waits = tenpaiCheck ? handWaits(s, seat) : [];
  return {
    seat,
    hand,
    drawnTile: s.turn === seat ? s.drawnTile : null,
    legal: legalActions(s, seat),
    waits,
    furiten: waits.length > 0 && s.discards[seat].some((d) => waits.includes(d.tile >> 2)) || s.tempFuriten[seat] || s.riichiFuriten[seat],
  };
}

export function seatView(s: HandState, seat: Seat): SeatView {
  return { ...publicView(s), me: privateInfo(s, seat) };
}
