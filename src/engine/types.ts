import type { Seat, TileId, TileKind } from "./tiles";

export type MeldType = "chi" | "pon" | "minkan" | "ankan" | "kakan";

export interface Meld {
  type: MeldType;
  tiles: TileId[];
  /** The claimed tile (chi/pon/minkan/kakan base pon). Absent for ankan. */
  called?: TileId;
  /** Seat the claimed tile came from. */
  from?: Seat;
}

export interface DiscardEntry {
  tile: TileId;
  tsumogiri: boolean;
  riichi: boolean;
  calledBy: Seat | null;
}

export type ClaimOption =
  | { type: "ron" }
  | { type: "pon"; tiles: [TileId, TileId] }
  | { type: "chi"; tiles: [TileId, TileId] }
  | { type: "minkan" };

export type Action =
  | { type: "discard"; tile: TileId; riichi?: boolean }
  | { type: "tsumo" }
  | { type: "ankan"; kind: TileKind }
  | { type: "kakan"; kind: TileKind }
  | { type: "ron" }
  | { type: "pon"; tiles: [TileId, TileId] }
  | { type: "chi"; tiles: [TileId, TileId] }
  | { type: "minkan" }
  | { type: "pass" };

export interface LegalActions {
  /** Tiles that may be discarded now (empty if not this seat's discard). */
  discard: TileId[];
  /** Tiles whose discard may be declared riichi. */
  riichi: TileId[];
  tsumo: boolean;
  ankan: TileKind[];
  kakan: TileKind[];
  /** Claim options on the current discard (pass is always allowed when non-empty). */
  claim: ClaimOption[];
}

export interface ClaimWindow {
  tile: TileId;
  from: Seat;
  /** Per seat; empty array = not eligible. Never sent to other seats. */
  options: ClaimOption[][];
  responses: (Action | null)[];
}

export interface YakuLine { name: string; han: number }

export type HandResult =
  | {
      type: "win";
      winner: Seat;
      from: Seat | null; // null = tsumo
      winTile: TileId;
      han: number;
      fu: number;
      yaku: YakuLine[];
      dora: number;
      points: number;
      deltas: number[];
    }
  | { type: "draw"; tenpai: Seat[]; deltas: number[] };

export type Outcome = Seat | "draw";

export interface HandConfig {
  seed: string;
  handNumber: number;
  dealer: Seat;
  roundWind: TileKind;
  scores: number[];
  riichiSticks: number;
}

/** Public log entry. Contains only information every participant may see. */
export type PublicEvent =
  | { type: "deal"; dealer: Seat }
  | { type: "draw"; seat: Seat; rinshan: boolean }
  | { type: "discard"; seat: Seat; tile: TileId; tsumogiri: boolean; riichi: boolean }
  | { type: "call"; seat: Seat; meld: Meld }
  | { type: "dora"; indicator: TileId }
  | { type: "win"; seat: Seat; from: Seat | null }
  | { type: "exhaustive" };

export interface HandState {
  config: HandConfig;
  handId: string;
  wall: TileId[];
  deadWall: TileId[];
  doraIndicators: TileId[];
  kanCount: number;
  hands: TileId[][];
  melds: Meld[][];
  discards: DiscardEntry[][];
  riichi: ({ discardIndex: number; ippatsu: boolean } | null)[];
  /** Temporary furiten: passed a ron since own last draw. */
  tempFuriten: boolean[];
  /** Riichi furiten: passed a ron after declaring riichi (lasts the whole hand). */
  riichiFuriten: boolean[];
  turn: Seat;
  phase: "discard" | "claim" | "ended";
  drawnTile: TileId | null;
  afterKan: boolean;
  mustDiscard: boolean;
  kuikaeBan: TileKind | null;
  claim: ClaimWindow | null;
  scores: number[];
  riichiSticks: number;
  result: HandResult | null;
  version: number;
  events: PublicEvent[];
}
