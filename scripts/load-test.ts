// Load test: one room, four fast table bots, N spectator sockets, and two traders.
// Measures fan-out latency (order sent → every spectator has seen the trade on the tape),
// message volume, and server memory. Usage: npx tsx scripts/load-test.ts [spectators=200] [trades=20]

import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createApp } from "../src/server/app";
import type { ServerMessage } from "../src/shared/protocol";

const N = Number(process.argv[2] ?? 200);
const TRADES = Number(process.argv[3] ?? 20);

const app = createApp({ allowSeededRooms: true });
await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
const port = (app.server.address() as AddressInfo).port;
const url = `ws://127.0.0.1:${port}/ws`;

const res = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "exchange", name: "Host" }) });
const { code, token } = (await res.json()) as { code: string; token: string };

let messages = 0, bytes = 0;
function connect(hello: object, onMsg?: (m: ServerMessage) => void): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      ws.send(JSON.stringify(hello));
      resolve(ws);
    });
    ws.on("message", (d) => {
      messages++;
      bytes += (d as Buffer).length;
      onMsg?.(JSON.parse(d.toString()));
    });
  });
}

const host = await connect({ t: "hello", room: code, token });
host.send(JSON.stringify({ t: "settings", settings: { botDelayMs: 250 } }));
for (const s of [0, 1, 2, 3]) host.send(JSON.stringify({ t: "addBot", seat: s, bot: "smart" }));

// Spectators: N independent sockets. Each records when it first sees each trade id.
const specs: WebSocket[] = [];
let handId = "";
for (let i = 0; i < N; i++) {
  specs.push(
    await connect({ t: "hello", room: code, name: `spec${i}` }, (m) => {
      if (m.t === "state" && m.table) handId = m.table.handId;
    }),
  );
}
// Per-socket first-seen tracking.
const firstSeen = new Map<string, Map<number, number>>();
specs.forEach((ws, i) =>
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    if (m.t !== "state" || !m.market) return;
    for (const t of m.market.shared.tape) {
      let per = firstSeen.get(t.id);
      if (!per) firstSeen.set(t.id, (per = new Map()));
      if (!per.has(i)) per.set(i, performance.now());
    }
  }),
);

const traderA = await connect({ t: "hello", room: code, name: "A" });
const traderB = await connect({ t: "hello", room: code, name: "B" });
await new Promise((r) => setTimeout(r, 300));
host.send(JSON.stringify({ t: "start" }));
while (!handId) await new Promise((r) => setTimeout(r, 20));

const lat: number[] = [];
for (let k = 0; k < TRADES; k++) {
  const before = new Set(firstSeen.keys());
  traderA.send(JSON.stringify({ t: "order", handId, contract: "SEAT_1", side: "buy", price: 40, qty: 1, tif: "gtc" }));
  const sent = performance.now();
  traderB.send(JSON.stringify({ t: "order", handId, contract: "SEAT_1", side: "sell", price: 40, qty: 1, tif: "ioc" }));
  const deadline = Date.now() + 10000;
  let tradeId: string | undefined;
  while (Date.now() < deadline) {
    tradeId = [...firstSeen.keys()].find((id) => !before.has(id));
    if (tradeId && firstSeen.get(tradeId)!.size === N) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!tradeId || firstSeen.get(tradeId)!.size < N) {
    console.log(`trade ${k}: not seen by all spectators (hand may have ended)`);
    break;
  }
  lat.push(Math.max(...firstSeen.get(tradeId)!.values()) - sent);
  await new Promise((r) => setTimeout(r, 150));
}

lat.sort((a, b) => a - b);
const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]?.toFixed(1);
const mem = process.memoryUsage();
console.log(
  JSON.stringify(
    {
      spectators: N,
      trades: lat.length,
      fanoutLatencyMs: { p50: q(0.5), p95: q(0.95), max: lat.at(-1)?.toFixed(1) },
      messagesReceived: messages,
      megabytesReceived: (bytes / 1e6).toFixed(1),
      serverProcessRssMB: (mem.rss / 1e6).toFixed(0),
      note: "client and server share one process; latency includes client JSON parsing for all sockets",
    },
    null,
    2,
  ),
);
for (const ws of [host, traderA, traderB, ...specs]) ws.close();
await app.close();
process.exit(0);
