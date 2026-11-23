// House quoting policy: fair value from the model, then a spread, then an inventory
// adjustment. Pure function; the room decides when to call it.
//
//   fv   = 100 · p
//   mid  = fv − skewPerShare · inventory          (inventory-aware policy; skew = 0 → fixed spread)
//   bid  = floor(mid − halfSpread), ask = ceil(mid + halfSpread), clamped to [1, 99]
//   a side is withdrawn when |inventory| ≥ maxInventory in that direction.

import { CONTRACTS, type ContractId } from "../market/types";

export interface QuoterParams {
  halfSpread: number;
  size: number;
  /** Ticks of mid shift per share of house inventory (0 = fixed-spread policy). */
  skewPerShare: number;
  maxInventory: number;
}

export const FIXED_SPREAD: QuoterParams = { halfSpread: 3, size: 20, skewPerShare: 0, maxInventory: 400 };
export const INVENTORY_AWARE: QuoterParams = { halfSpread: 3, size: 20, skewPerShare: 0.08, maxInventory: 400 };
export const HOUSE_DEFAULT = INVENTORY_AWARE;

export interface ContractQuote {
  contract: ContractId;
  fair: number; // fair value in ticks (unrounded)
  bid: number | null;
  ask: number | null;
  size: number;
}

export function quote(probs: number[], inventory: Record<ContractId, number>, p: QuoterParams): ContractQuote[] {
  return CONTRACTS.map((contract, i) => {
    const fair = 100 * probs[i];
    const inv = inventory[contract];
    const mid = fair - p.skewPerShare * inv;
    let bid: number | null = Math.max(1, Math.min(98, Math.floor(mid - p.halfSpread)));
    let ask: number | null = Math.min(99, Math.max(2, Math.ceil(mid + p.halfSpread)));
    if (ask <= bid) ask = bid + 1;
    if (inv >= p.maxInventory) bid = null; // too long: stop buying
    if (inv <= -p.maxInventory) ask = null; // too short: stop selling
    return { contract, fair, bid, ask, size: p.size };
  });
}
