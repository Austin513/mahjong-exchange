// Wire protocol shared by client and server (types only, no runtime deps). Client ->
// server messages are validated by src/server/schema.ts; authorization is always derived from the session, never
// from fields in the message.

import type { PrivateSeatInfo, PublicTableView } from "../engine/views";
import type { Action } from "../engine/types";

export type GameMode = "house" | "exchange";
export type TableBotKind = "smart" | "random";
export type TradingBotKind = "informed" | "public" | "noise" | "random";
export const TRADING_BOT_KINDS: TradingBotKind[] = ["informed", "public", "noise", "random"];

export interface RoomSettings {
  /** Seated players may trade using their own tile knowledge. */
  seatedCanTrade: boolean;
  /** Delay before a table bot acts (ms). */
  botDelayMs: number;
  /** Discard decision timer for humans (s); autopilot after it expires. */
  turnSeconds: number;
  /** Claim decision timer for humans (s). */
  claimSeconds: number;
  /** Open Exchange trading bots: count per kind. */
  tradingBots: Record<TradingBotKind, number>;
  /** Milliseconds between a trading bot's decisions. */
  tradingBotPaceMs: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  seatedCanTrade: true,
  botDelayMs: 700,
  turnSeconds: 40,
  claimSeconds: 12,
  tradingBots: { informed: 0, public: 0, noise: 0, random: 0 },
  tradingBotPaceMs: 2500,
};

// ------------------------------------------------------------- client -> server

export type SeatIndex = 0 | 1 | 2 | 3;

/** Every command a client can send. Validated by src/server/schema.ts. */
export type ClientMessage =
  | { t: "hello"; room: string; token?: string; name?: string }
  | { t: "sit"; seat: number }
  | { t: "stand" }
  | { t: "addBot"; seat: number; bot: TableBotKind }
  | { t: "removeBot"; seat: number }
  | { t: "settings"; settings: Partial<RoomSettings> }
  | { t: "start" }
  | { t: "act"; handId: string; action: Action }
  | { t: "ping" };


// ------------------------------------------------------------- server -> client

export type SeatOccupantView =
  | { kind: "human"; participantId: string; name: string; connected: boolean; away: boolean }
  | { kind: "bot"; bot: TableBotKind; name: string }
  | null;

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
  seat: number | null;
  isHost: boolean;
  isBot: boolean;
}

export interface RoomView {
  code: string;
  mode: GameMode;
  phase: "lobby" | "playing" | "hand-over";
  hostId: string;
  settings: RoomSettings;
  seats: SeatOccupantView[];
  participants: ParticipantView[];
  spectatorCount: number;
  handNumber: number;
  seeded: boolean;
  /** Epoch ms deadline for each seat's pending decision (humans only). */
  deadlines: (number | null)[];
  feed: FeedItem[];
  /** Server clock at send time, for client countdowns. */
  serverNow: number;
}

export interface FeedItem { id: number; at: number; kind: "table" | "market" | "room"; text: string }

export interface YouView {
  participantId: string;
  name: string;
  seat: number | null;
  isHost: boolean;
  canTrade: boolean;
  tradeBlockedReason: string | null;
}

export interface StateMessage {
  t: "state";
  room: RoomView;
  table: PublicTableView | null;
  me: PrivateSeatInfo | null;
  you: YouView;
}

export type ServerMessage =
  | { t: "welcome"; token: string; participantId: string; room: string }
  | StateMessage
  | { t: "error"; code: string; message: string }
  | { t: "notice"; text: string }
  | { t: "pong" };

export const seatName = (s: number) => ["Seat A", "Seat B", "Seat C", "Seat D"][s];
