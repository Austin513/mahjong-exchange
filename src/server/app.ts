// HTTP + WebSocket server. One process, isolated rooms. Limits: 64 KB per message,
// a token bucket of 30 msg/s (burst 60) per socket, MAX_CONNECTIONS sockets per process.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { parseClientMessage } from "./schema";
import { RoomRegistry } from "./rooms";
import type { Conn, Room, RoomOptions } from "./room";
import { MarketRoom } from "./marketRoom";
import { sanitizeName } from "./room";

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_CONNECTIONS = 2000;
const RATE_PER_SEC = 30;
const RATE_BURST = 60;

export interface AppOptions {
  /** Allow `seed` on room creation (deterministic walls). Never enable in production. */
  allowSeededRooms: boolean;
  roomFactory?: (opts: RoomOptions) => Room;
  /** Handles non-API requests (static files or the Vite dev middleware). */
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
}

const createRoomSchema = z.object({
  mode: z.enum(["house", "exchange"]),
  name: z.string().min(1).max(40),
  seed: z.string().max(40).optional(),
});

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 8 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createApp(opts: AppOptions): { server: Server; registry: RoomRegistry; close: () => Promise<void> } {
  const registry = new RoomRegistry(opts.roomFactory ?? ((o) => new MarketRoom(o)));
  let connections = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "POST" && url.pathname === "/api/rooms") {
        const parsed = createRoomSchema.safeParse(JSON.parse((await readBody(req)) || "{}"));
        if (!parsed.success || !sanitizeName(parsed.data.name)) return json(res, 400, { error: "Enter a display name and choose a game." });
        if (parsed.data.seed && !opts.allowSeededRooms) return json(res, 400, { error: "Seeded rooms are disabled on this server." });
        const room = registry.create(parsed.data.mode, parsed.data.seed);
        const p = room.addParticipant(parsed.data.name);
        return json(res, 201, { code: room.code, token: p.token, participantId: p.id });
      }
      const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})$/);
      if (req.method === "GET" && m) {
        const room = registry.get(m[1]);
        if (!room) return json(res, 404, { error: `No room with code ${m[1].toUpperCase()}. Check the code or ask the host for a new invite link.` });
        const v = room.roomView();
        return json(res, 200, { code: room.code, mode: room.mode, phase: v.phase, seatsOpen: v.seats.filter((s) => !s || s.kind === "bot").length, spectators: v.spectatorCount });
      }
      if (url.pathname === "/api/health") return json(res, 200, { ok: true, rooms: registry.size(), connections });
      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
      if (opts.fallback) return opts.fallback(req, res);
      res.writeHead(404).end();
    } catch {
      json(res, 400, { error: "Bad request" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (ws: WebSocket) => {
    if (connections >= MAX_CONNECTIONS) {
      ws.close(1013, "Server is at capacity, try again shortly");
      return;
    }
    connections++;
    let room: Room | undefined;
    let tokens = RATE_BURST;
    let last = Date.now();
    const conn: Conn = {
      id: randomBytes(6).toString("hex"),
      participantId: null,
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
    };
    const sendErr = (code: string, message: string) => conn.send(JSON.stringify({ t: "error", code, message }));
    const helloTimer = setTimeout(() => {
      if (!room) ws.close(4000, "hello timeout");
    }, 10000);

    ws.on("message", (raw) => {
      const now = Date.now();
      tokens = Math.min(RATE_BURST, tokens + ((now - last) / 1000) * RATE_PER_SEC);
      last = now;
      if (tokens < 1) return sendErr("rate_limited", "Too many messages — slow down and try again.");
      tokens -= 1;
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return sendErr("bad_json", "Malformed message.");
      }
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return sendErr("invalid", "That request was not valid. Refresh the page and try again.");
      const msg = parsed.msg;
      if (msg.t === "hello") {
        if (room) return sendErr("already_joined", "Already joined.");
        const r = registry.get(msg.room);
        if (!r) return sendErr("no_room", `No room with code ${msg.room.toUpperCase()}. Check the code or ask the host for a new invite link.`);
        const res = r.attach(conn, msg.token, msg.name);
        if (!res.ok) return sendErr(res.code, res.message);
        room = r;
        return;
      }
      if (msg.t === "ping") return conn.send('{"t":"pong"}');
      if (!room) return sendErr("not_joined", "Join a room first.");
      room.handle(conn, msg);
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      connections--;
      room?.detach(conn);
    });
    ws.on("error", () => ws.close());
  });

  const sweeper = setInterval(() => registry.sweep(), 10 * 60 * 1000);
  sweeper.unref();

  return {
    server,
    registry,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        for (const c of wss.clients) c.terminate();
        wss.close();
        registry.disposeAll();
        server.close(() => resolve());
      }),
  };
}
