import type { Outcome } from "../engine/types";

export const CONTRACTS = ["SEAT_0", "SEAT_1", "SEAT_2", "SEAT_3", "DRAW"] as const;
export type ContractId = (typeof CONTRACTS)[number];

/** Payout per share of the winning contract, in ticks (1 tick = 1 credit). */
export const PAYOUT = 100;
export const STARTING_CREDITS = 10_000;

export type Side = "buy" | "sell";
export type TimeInForce = "gtc" | "ioc";
export type AccountKind = "human" | "house" | "bot";

export const contractForOutcome = (o: Outcome): ContractId => (o === "draw" ? "DRAW" : (`SEAT_${o}` as ContractId));

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Cash in credits. Trades move it; settlement pays into it. */
  cash: number;
  /** Signed share positions for the current hand's contracts. */
  positions: Record<ContractId, number>;
  /** Cash at the moment the current hand opened (or the account was created). */
  handStartCash: number;
  /** Sum of settled hand P&L since the account was created. */
  settledPnl: number;
}

export interface Order {
  id: string;
  accountId: string;
  contract: ContractId;
  side: Side;
  price: number;
  /** Remaining quantity. */
  qty: number;
  origQty: number;
  filledQty: number;
  tif: TimeInForce;
  seq: number;
  createdAt: number;
  /**
   * Cash still reserved for the unfilled remainder: buy = remaining × price;
   * sell = uncovered (short) remaining × (100 − price).
   */
  reservedCash: number;
  /** Sell orders: remaining shares covered by an existing long position. */
  coveredRemaining: number;
  status: "open" | "filled" | "cancelled";
  cancelReason?: "user" | "ioc" | "stp" | "settlement" | "requote";
}

export interface Trade {
  id: string;
  contract: ContractId;
  price: number;
  qty: number;
  buyer: string;
  seller: string;
  buyOrderId: string;
  sellOrderId: string;
  /** Side of the incoming (aggressing) order. */
  aggressor: Side;
  at: number;
  seq: number;
}

export interface PlaceResult {
  ok: true;
  order: Order;
  fills: Trade[];
  /** The account's own resting orders cancelled by self-trade prevention. */
  stpCancelled: Order[];
  status: "filled" | "resting" | "partial-resting" | "cancelled" | "partial-cancelled";
}

export type PlaceError = { ok: false; code: string; message: string };

export interface AccountSettlement {
  accountId: string;
  positions: Record<ContractId, number>;
  payout: number;
  pnl: number;
}

export interface SettlementRecord {
  handId: string;
  outcome: Outcome;
  winningContract: ContractId;
  accounts: Record<string, AccountSettlement>;
  at: number;
}

export const emptyPositions = (): Record<ContractId, number> => ({ SEAT_0: 0, SEAT_1: 0, SEAT_2: 0, SEAT_3: 0, DRAW: 0 });
