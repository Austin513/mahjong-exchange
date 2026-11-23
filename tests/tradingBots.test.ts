import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { informedPolicy, noisePolicy, publicPolicy, randomPolicy, type BotSnapshot } from "../src/bots/trading/policies";
import { CONTRACTS, emptyPositions, type ContractId } from "../src/market/types";
import { makeRng } from "../src/engine/rng";
import { TradingRoom } from "../src/server/tradingRoom";
import { FakeClient, tick } from "./helpers";

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  // Seat books sit near the public fair value of 22, and the draw book near 12.
  const book = Object.fromEntries(CONTRACTS.map((c) => [c, c === "DRAW" ? { bid: 9, bidQty: 10, ask: 15, askQty: 10 } : { bid: 18, bidQty: 10, ask: 24, askQty: 10 }])) as Record<ContractId, BotSnapshot["book"][ContractId]>;
  return {
    publicProbs: [0.22, 0.22, 0.22, 0.22, 0.12],
    progress: 0.5,
    book,
    bookExOwn: book,
    positions: emptyPositions(),
    available: 10_000,
    openOrderCount: 0,
    ...overrides,
  };
}

const takes = (acts: ReturnType<typeof publicPolicy>) => acts.filter((a) => a.type === "order" && a.tif === "ioc");

describe("trading bot policies are distinct", () => {
  it("same book, different inputs: the informed bot buys its tenpai seat; the public bot does not", () => {
    const base = snapshot();
    const informed = informedPolicy({ ...base, privateSeat: { seat: 1, features: { shanten: 0, ukeire: 8 } } });
    const pub = publicPolicy(base);
    expect(takes(informed)).toContainEqual(expect.objectContaining({ contract: "SEAT_1", side: "buy", price: 24 }));
    expect(takes(pub)).toEqual([]);
    // With a hopeless private hand the informed bot sells its own seat instead.
    const far = informedPolicy({ ...base, privateSeat: { seat: 1, features: { shanten: 4, ukeire: 10 } } });
    expect(takes(far).some((a) => a.type === "order" && a.contract === "SEAT_1" && a.side === "buy")).toBe(false);
  });

  it("the informed bot does nothing without an attached bot seat", () => {
    expect(informedPolicy(snapshot())).toEqual([]);
  });

  it("noise trades for liquidity needs regardless of the hand, and works down large inventory", () => {
    const st = { nextNeedAt: 1, decisions: 0 };
    const acts = noisePolicy(snapshot(), st, makeRng("n"));
    expect(acts.some((a) => a.type === "order" && a.reason.includes("liquidity"))).toBe(true);
    const heavy = noisePolicy(snapshot({ positions: { ...emptyPositions(), DRAW: 40 } }), { nextNeedAt: 99, decisions: 0 }, makeRng("n"));
    expect(heavy).toContainEqual(expect.objectContaining({ contract: "DRAW", side: "sell", reason: "noise: reduce inventory" }));
  });

  it("random is reproducible from its seed and bounded", () => {
    const run = (seed: string) => {
      const rng = makeRng(seed);
      return Array.from({ length: 20 }, () => randomPolicy(snapshot(), rng));
    };
    expect(run("r1")).toEqual(run("r1"));
    expect(run("r1")).not.toEqual(run("r2"));
    for (const acts of run("r3")) for (const a of acts) if (a.type === "order") expect(a.price >= 1 && a.price <= 99 && a.qty <= 10).toBe(true);
  });
});

describe("trading bots in a room", () => {
  let room: TradingRoom;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    room.dispose();
    vi.useRealTimers();
  });

  it("each bot has its own identity, trades through the same rules, and the informed bot never leaks tiles", () => {
    room = new TradingRoom({
      code: "BOTS1",
      mode: "exchange",
      seed: "bots",
      settings: { botDelayMs: 600000, tradingBots: { informed: 1, public: 1, noise: 1, random: 1 }, tradingBotPaceMs: 1000 },
    });
    const host = new FakeClient(room, "Host");
    for (const s of [0, 1, 2, 3]) host.send({ t: "addBot", seat: s, bot: "smart" });
    const spec = new FakeClient(room, "Spectator");
    host.send({ t: "start" });
    for (let i = 0; i < 12; i++) {
      tick(1000);
      room.exchange.checkInvariants();
    }
    tick();
    const shared = spec.state!.market!.shared;
    expect(shared.bots.map((b) => b.kind).sort()).toEqual(["informed", "noise", "public", "random"]);
    expect(shared.bots.find((b) => b.kind === "informed")!.attachedSeat).toBe(0);
    for (const k of ["informed", "public", "noise", "random"] as const) expect(room.decisions[k]).toBeGreaterThan(5);
    const informedOrders = [...room.exchange.orders.values()].filter((o) => o.accountId === "bot-informed-1");
    expect(informedOrders.length).toBeGreaterThan(0); // it affects order flow
    expect(room.exchange.trades.length).toBeGreaterThan(0);
    // Privacy: the informed bot's seat hand never appears in what the spectator receives.
    const hidden = JSON.stringify(room.hand!.hands[0]);
    for (const raw of spec.raw) {
      const msg = JSON.parse(raw);
      if (msg.t === "state" && msg.table?.phase !== "ended") expect(raw).not.toContain(hidden);
    }
  });

  it("explains when informed bots cannot attach, and never attaches to a human seat", () => {
    room = new TradingRoom({ code: "BOTS2", mode: "exchange", seed: "bots2", settings: { botDelayMs: 600000, tradingBots: { informed: 2, public: 0, noise: 0, random: 0 } } });
    const host = new FakeClient(room, "Host");
    host.send({ t: "sit", seat: 0 });
    host.send({ t: "addBot", seat: 1, bot: "smart" });
    tick();
    const shared = () => host.state!.market!.shared;
    expect(shared().bots.map((b) => b.attachedSeat)).toEqual([1]);
    expect(shared().botSetupNote).toMatch(/Only 1 bot-controlled seat/);
    host.send({ t: "removeBot", seat: 1 });
    tick();
    expect(shared().bots).toEqual([]);
    expect(shared().botSetupNote).toMatch(/never a human's/);
  });

  it("House mode has no trading bots", () => {
    room = new TradingRoom({ code: "BOTS3", mode: "house", seed: "b3", settings: { tradingBots: { informed: 1, public: 1, noise: 1, random: 1 } } });
    const host = new FakeClient(room, "Host");
    tick();
    expect(host.state!.market!.shared.bots).toEqual([]);
  });
});
