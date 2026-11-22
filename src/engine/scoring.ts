// Win evaluation. Structural yaku, fu, and points come from @pai-forge/riichi-mahjong
// (ISC). That library deliberately excludes situational yaku, so riichi, ippatsu,
// haitei, houtei, and rinshan kaihou are added here. Hands whose only yaku are
// situational are scored at 30 fu (documented simplification). No ura-dora.

import {
  calculateScore,
  calculateScoreForTehai,
  countDora,
  validateTehai14,
  type CompletedMentsu,
  type Fu,
  type HaiKindId,
  type Kazehai,
  type Payment,
  type Tehai,
} from "@pai-forge/riichi-mahjong";
import type { Meld, YakuLine } from "./types";
import { doraFromIndicator, kindOf, type Seat, type TileId, type TileKind } from "./tiles";

export interface WinContext {
  seat: Seat;
  dealer: Seat;
  roundWind: TileKind;
  seatWind: TileKind;
  isTsumo: boolean;
  riichi: boolean;
  ippatsu: boolean;
  haitei: boolean;
  houtei: boolean;
  rinshan: boolean;
  doraIndicators: TileKind[];
}

export interface WinScore {
  han: number;
  fu: number;
  yaku: YakuLine[];
  dora: number;
  /** Per-payer amounts: ron -> discarder pays `ron`; tsumo -> dealer/non-dealer amounts. */
  payment: Payment;
}

function toMentsu(m: Meld, seat: Seat): CompletedMentsu {
  const hais = m.tiles.map(kindOf) as HaiKindId[];
  const from = m.from === undefined ? undefined : ((((m.from - seat) % 4) + 4) % 4 as 1 | 2 | 3);
  const naki = (m.called === undefined ? hais[0] : kindOf(m.called)) as HaiKindId;
  switch (m.type) {
    case "chi":
      return { type: "Shuntsu", hais: [...hais].sort((a, b) => a - b) as [HaiKindId, HaiKindId, HaiKindId], furo: { type: "Chi", from: 3, nakiHai: naki } };
    case "pon":
      return { type: "Koutsu", hais: hais as [HaiKindId, HaiKindId, HaiKindId], furo: { type: "Pon", from: from!, nakiHai: naki } };
    case "minkan":
      return { type: "Kantsu", hais: hais as [HaiKindId, HaiKindId, HaiKindId, HaiKindId], furo: { type: "Daiminkan", from: from!, nakiHai: naki } };
    case "kakan":
      return { type: "Kantsu", hais: hais as [HaiKindId, HaiKindId, HaiKindId, HaiKindId], furo: { type: "Kakan", from: from!, nakiHai: naki, kakanHai: hais[3] } };
    case "ankan":
      return { type: "Kantsu", hais: hais as [HaiKindId, HaiKindId, HaiKindId, HaiKindId] };
  }
}

const SITUATIONAL: [keyof WinContext, string][] = [
  ["riichi", "Riichi"],
  ["ippatsu", "Ippatsu"],
  ["haitei", "Haitei"],
  ["houtei", "Houtei"],
  ["rinshan", "Rinshan Kaihou"],
];

/**
 * Score a complete 14-tile hand (closed tiles include the winning tile).
 * Returns null when the hand is not a legal win (incomplete or no yaku).
 */
export function scoreWin(closed: TileId[], melds: Meld[], winTile: TileId, ctx: WinContext): WinScore | null {
  const tehai: Tehai = {
    closed: closed.map(kindOf).sort((a, b) => a - b) as HaiKindId[],
    exposed: melds.map((m) => toMentsu(m, ctx.seat)),
  };
  const valid = validateTehai14(tehai);
  if (valid.isErr()) return null;

  const extra: YakuLine[] = SITUATIONAL.filter(([k]) => ctx[k]).map(([, name]) => ({ name, han: 1 }));
  const extraHan = extra.length;
  const doraMarkers = ctx.doraIndicators as HaiKindId[];
  const isOya = ctx.seat === ctx.dealer;
  const res = calculateScoreForTehai(valid.value, {
    agariHai: kindOf(winTile) as HaiKindId,
    bakaze: ctx.roundWind as Kazehai,
    jikaze: ctx.seatWind as Kazehai,
    isTsumo: ctx.isTsumo,
    doraMarkers,
  });

  if (res.isOk()) {
    const r = res.value;
    const structural = r.detail.yakuResult.map(([name, han]) => ({ name: String(name), han: Number(han) }));
    const yakuHan = structural.reduce((s, y) => s + y.han, 0);
    const dora = Math.max(0, r.han - yakuHan);
    if (r.scoreLevel === "Yakuman" || extraHan === 0) {
      return { han: r.han, fu: r.fu, yaku: structural, dora, payment: r.payment };
    }
    const han = r.han + extraHan;
    const s = calculateScore(han, r.fu, { isOya, isTsumo: ctx.isTsumo });
    return { han, fu: r.fu, yaku: [...extra, ...structural], dora, payment: s.payment };
  }

  // No structural yaku: only a win if a situational yaku applies.
  if (extraHan === 0) return null;
  const dora = countDora(tehai, doraMarkers);
  const han = extraHan + dora;
  const fu: Fu = 30;
  const s = calculateScore(han, fu, { isOya, isTsumo: ctx.isTsumo });
  return { han, fu, yaku: extra, dora, payment: s.payment };
}

/** Point transfers for a win. Index = seat. Riichi sticks go to the winner. */
export function winDeltas(payment: Payment, winner: Seat, from: Seat | null, dealer: Seat, sticks: number): number[] {
  const d = [0, 0, 0, 0];
  if (payment.type === "ron") {
    d[from!] -= payment.amount;
    d[winner] += payment.amount;
  } else {
    for (let s = 0; s < 4; s++) {
      if (s === winner) continue;
      const amt = payment.type === "oyaTsumo" ? payment.amount : s === dealer ? payment.amount[1] : payment.amount[0];
      d[s] -= amt;
      d[winner] += amt;
    }
  }
  d[winner] += sticks * 1000;
  return d;
}

export const paymentTotal = (p: Payment): number =>
  p.type === "ron" ? p.amount : p.type === "oyaTsumo" ? p.amount * 3 : p.amount[0] * 2 + p.amount[1];

export const doraKinds = (indicators: TileId[]): TileKind[] => indicators.map((t) => doraFromIndicator(kindOf(t)));
