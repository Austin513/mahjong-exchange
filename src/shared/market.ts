// Market payloads (server -> client). `shared` is identical for everyone in the room;
// `mine` is built per participant from their own account only.

import type { ContractId, Side, TimeInForce } from "../market/types";
import type { Outcome } from "../engine/types";

export interface Level {
  price: number;
  qty: number;
  orders: number;
}

export interface ContractView {
  id: ContractId;
  label: string;
  bids: Level[];
  asks: Level[];
  last: number | null;
  volume: number;
  /** House mode: house quote and the model fair value behind it. */
  house?: { bid: number | null; ask: number | null; bidSize: number; askSize: number; fair: number };
}

export interface FairPoint {
  version: number;
  at: number;
  label: string;
  probs: number[];
}

export interface TradeView {
  id: string;
  contract: ContractId;
  price: number;
  qty: number;
  at: number;
  aggressor: Side;
  buyer: string;
  seller: string;
}

export interface LeaderRow {
  name: string;
  kind: "human" | "house" | "bot";
  settledPnl: number;
  cash: number;
}

export interface BotView {
  id: string;
  name: string;
  kind: "informed" | "public" | "noise" | "random";
  description: string;
  attachedSeat: number | null;
  settledPnl: number;
}

export interface MarketShared {
  mode: "house" | "exchange";
  status: "idle" | "open" | "closed";
  handId: string | null;
  contracts: ContractView[];
  tape: TradeView[];
  fairSeries: FairPoint[];
  explanation: string | null;
  leaderboard: LeaderRow[];
  house: { inventory: Record<ContractId, number>; halfSpread: number; skewPerShare: number; size: number; settledPnl: number } | null;
  bots: BotView[];
  botSetupNote: string | null;
  lastSettlement: { handId: string; outcome: Outcome; winningContract: ContractId } | null;
}

export interface OrderView {
  id: string;
  contract: ContractId;
  side: Side;
  price: number;
  qty: number;
  origQty: number;
  filledQty: number;
  tif: TimeInForce;
  status: "open" | "filled" | "cancelled";
  cancelReason?: string;
  createdAt: number;
}

export interface AccountView {
  cash: number;
  available: number;
  reserved: number;
  shortLock: number;
  positions: Record<ContractId, number>;
  settledPnl: number;
  /** Cash change since this hand opened (trade proceeds minus costs, before settlement). */
  handCashFlow: number;
  startingCredits: number;
}

export interface MySettlement {
  handId: string;
  winningContract: ContractId;
  positions: Record<ContractId, number>;
  payout: number;
  pnl: number;
}

export interface MarketMine {
  account: AccountView;
  openOrders: OrderView[];
  recentOrders: OrderView[];
  fills: (TradeView & { side: Side })[];
  settlement: MySettlement | null;
}

export interface MarketView {
  shared: MarketShared;
  mine: MarketMine | null;
}
