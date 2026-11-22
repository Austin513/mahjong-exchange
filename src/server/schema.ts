// Runtime validation of client messages. The `satisfies` checks keep these schemas in
// lockstep with the explicit protocol types in src/shared/protocol.ts.

import { z } from "zod";
import type { ClientMessage } from "../shared/protocol";

const tile = z.number().int().min(0).max(135);
const kind = z.number().int().min(0).max(33);
const seat = z.number().int().min(0).max(3);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("discard"), tile, riichi: z.boolean().optional() }),
  z.object({ type: z.literal("tsumo") }),
  z.object({ type: z.literal("ankan"), kind }),
  z.object({ type: z.literal("kakan"), kind }),
  z.object({ type: z.literal("ron") }),
  z.object({ type: z.literal("pon"), tiles: z.tuple([tile, tile]) }),
  z.object({ type: z.literal("chi"), tiles: z.tuple([tile, tile]) }),
  z.object({ type: z.literal("minkan") }),
  z.object({ type: z.literal("pass") }),
]);

const settingsSchema = z
  .object({
    seatedCanTrade: z.boolean(),
    botDelayMs: z.number().int().min(0).max(5000),
    turnSeconds: z.number().int().min(5).max(300),
    claimSeconds: z.number().int().min(3).max(60),
    tradingBots: z.object({
      informed: z.number().int().min(0).max(4),
      public: z.number().int().min(0).max(6),
      noise: z.number().int().min(0).max(6),
      random: z.number().int().min(0).max(6),
    }),
    tradingBotPaceMs: z.number().int().min(250).max(30000),
  })
  .partial();

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), room: z.string().min(4).max(8), token: z.string().max(64).optional(), name: z.string().max(40).optional() }),
  z.object({ t: z.literal("sit"), seat }),
  z.object({ t: z.literal("stand") }),
  z.object({ t: z.literal("addBot"), seat, bot: z.enum(["smart", "random"]) }),
  z.object({ t: z.literal("removeBot"), seat }),
  z.object({ t: z.literal("settings"), settings: settingsSchema }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("act"), handId: z.string().max(80), action: actionSchema }),
  z.object({ t: z.literal("ping") }),
]);


// Compile-time check: every validated message is a valid ClientMessage.
export const parseClientMessage = (data: unknown): { ok: true; msg: ClientMessage } | { ok: false } => {
  const r = clientMessageSchema.safeParse(data);
  return r.success ? { ok: true, msg: r.data satisfies ClientMessage } : { ok: false };
};
