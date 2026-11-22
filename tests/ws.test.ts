// Integration over real HTTP + WebSocket connections (independent clients).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createApp } from "../src/server/app";
import type { ClientMessage, ServerMessage, StateMessage } from "../src/shared/protocol";

let base = "";
let wsUrl = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const app = createApp({ allowSeededRooms: true });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  const port = (app.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
  close = app.close;
});
afterAll(() => close());

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  token = "";
  id = "";
  private waiters: (() => void)[] = [];
  constructor() {
    this.ws = new WebSocket(wsUrl);
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === "welcome") {
        this.token = m.token;
        this.id = m.participantId;
      }
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  open() {
    return new Promise<void>((r) => (this.ws.readyState === WebSocket.OPEN ? r() : this.ws.once("open", () => r())));
  }
  send(m: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }
  get state(): StateMessage | undefined {
    return [...this.msgs].reverse().find((m): m is StateMessage => m.t === "state");
  }
  async until(pred: (c: Client) => boolean, ms = 4000) {
    const end = Date.now() + ms;
    while (!pred(this)) {
      if (Date.now() > end) throw new Error("timeout waiting for condition");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  lastError() {
    return [...this.msgs].reverse().find((m) => m.t === "error") as Extract<ServerMessage, { t: "error" }> | undefined;
  }
}

async function createRoom(mode: "house" | "exchange", name: string) {
  const res = await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, name, seed: "ws-test" }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; token: string };
}

describe("HTTP + WebSocket", () => {
  it("rejects an unknown room code with an actionable message", async () => {
    const res = await fetch(`${base}/api/rooms/ZZZZZ`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No room with code ZZZZZ/);
    const c = new Client();
    await c.open();
    c.send({ t: "hello", room: "ZZZZZ", name: "x" });
    await c.until((x) => !!x.lastError());
    expect(c.lastError()!.code).toBe("no_room");
    c.ws.close();
  });

  it("independent clients create, join, reconnect, and fill human-to-human in Open Exchange", async () => {
    const { code, token } = await createRoom("exchange", "Host");
    const host = new Client();
    await host.open();
    host.send({ t: "hello", room: code, token });
    await host.until((c) => !!c.state);
    expect(host.state!.you.isHost).toBe(true);
    host.send({ t: "settings", settings: { botDelayMs: 5000 } });
    for (const s of [0, 1, 2, 3]) host.send({ t: "addBot", seat: s, bot: "smart" });

    const alice = new Client();
    const bob = new Client();
    await Promise.all([alice.open(), bob.open()]);
    alice.send({ t: "hello", room: code.toLowerCase(), name: "Alice" });
    bob.send({ t: "hello", room: code, name: "Bob" });
    await alice.until((c) => !!c.state);
    await bob.until((c) => !!c.state);
    host.send({ t: "start" });
    await alice.until((c) => c.state?.market?.shared.status === "open");
    const handId = alice.state!.table!.handId;

    alice.send({ t: "order", handId, contract: "SEAT_2", side: "buy", price: 30, qty: 10, tif: "gtc" });
    await bob.until((c) => c.state?.market?.shared.contracts[2].bids.length === 1);
    bob.send({ t: "order", handId, contract: "SEAT_2", side: "sell", price: 30, qty: 6, tif: "ioc" });
    await alice.until((c) => c.state?.market?.mine?.account.positions.SEAT_2 === 6);
    expect(alice.state!.market!.shared.house).toBeNull();
    expect(alice.state!.market!.shared.tape[0]).toMatchObject({ price: 30, qty: 6, buyer: "Alice", seller: "Bob" });
    await bob.until((c) => c.state?.market?.mine?.account.positions.SEAT_2 === -6);

    // Refresh: Alice reconnects with her token -> same identity, same balance, no duplicate.
    const aliceId = alice.id;
    const aliceToken = alice.token;
    alice.ws.close();
    const again = new Client();
    await again.open();
    again.send({ t: "hello", room: code, token: aliceToken });
    await again.until((c) => !!c.state?.market?.mine);
    expect(again.id).toBe(aliceId);
    expect(again.state!.market!.mine!.account.positions.SEAT_2).toBe(6);
    expect(again.state!.room.participants.filter((p) => p.name === "Alice")).toHaveLength(1);
    expect(again.state!.me).toBeNull(); // spectator: no private hand
    for (const c of [host, bob, again]) c.ws.close();
  });

  it("validates messages and rate-limits floods", async () => {
    const { code, token } = await createRoom("house", "Host");
    const c = new Client();
    await c.open();
    c.send({ t: "hello", room: code, token });
    await c.until((x) => !!x.state);
    c.send({ t: "order", handId: "x", contract: "SEAT_9", side: "buy", price: 500, qty: 1, tif: "gtc" });
    await c.until((x) => x.lastError()?.code === "invalid");
    for (let i = 0; i < 120; i++) c.send({ t: "ping" });
    await c.until((x) => x.lastError()?.code === "rate_limited");
    c.ws.close();
  });
});
