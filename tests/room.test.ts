import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room, AWAY_GRACE_MS } from "../src/server/room";
import { FakeClient, runUntil, tick } from "./helpers";

let room: Room;
beforeEach(() => {
  vi.useFakeTimers();
  room = new Room({ code: "TEST1", mode: "house", seed: "room-test", settings: { botDelayMs: 0, turnSeconds: 5, claimSeconds: 3 } });
});
afterEach(() => {
  room.dispose();
  vi.useRealTimers();
});

function soloTable() {
  const host = new FakeClient(room, "Host");
  host.send({ t: "sit", seat: 0 });
  for (const s of [1, 2, 3]) host.send({ t: "addBot", seat: s, bot: "smart" });
  return host;
}

describe("membership and sessions", () => {
  it("requires a display name and issues a private session token", () => {
    const anon = new FakeClient(room);
    expect(anon.attachResult).toMatchObject({ ok: false, code: "name_required" });
    const a = new FakeClient(room, "Alice");
    expect(a.token).toHaveLength(22);
    tick();
    expect(JSON.stringify(a.state!.room)).not.toContain(a.token);
  });

  it("reconnects the same identity with its token without duplicating it", () => {
    const a = new FakeClient(room, "Alice");
    a.send({ t: "sit", seat: 2 });
    a.disconnect();
    const again = new FakeClient(room, undefined, a.token);
    expect(again.participantId).toBe(a.participantId);
    tick();
    const st = again.state!;
    expect(st.room.participants.filter((p) => p.name === "Alice")).toHaveLength(1);
    expect(st.you.seat).toBe(2);
  });

  it("knowing the room code does not grant control of another seat", () => {
    const a = soloTable();
    a.send({ t: "start" });
    tick();
    const intruder = new FakeClient(room, "Mallory"); // has the code, not the token
    const handId = a.state!.table!.handId;
    intruder.send({ t: "act", handId, action: { type: "discard", tile: a.state!.me!.hand[0] } });
    expect(intruder.lastError?.code).toBe("not_seated");
    expect(intruder.state?.me ?? null).toBeNull();
  });

  it("only the host can add bots, change settings, or start", () => {
    new FakeClient(room, "Host");
    const guest = new FakeClient(room, "Guest");
    guest.send({ t: "addBot", seat: 0, bot: "smart" });
    expect(guest.lastError?.code).toBe("not_host");
    guest.send({ t: "start" });
    expect(guest.lastError?.code).toBe("not_host");
  });
});

describe("seats", () => {
  it("prevents holding two seats and taking a human's seat", () => {
    const a = new FakeClient(room, "A");
    const b = new FakeClient(room, "B");
    a.send({ t: "sit", seat: 0 });
    a.send({ t: "sit", seat: 1 });
    expect(a.lastError?.code).toBe("already_seated");
    b.send({ t: "sit", seat: 0 });
    expect(b.lastError?.code).toBe("seat_taken");
  });

  it("refuses to start with empty seats and explains why", () => {
    const host = new FakeClient(room, "Host");
    host.send({ t: "sit", seat: 0 });
    host.send({ t: "start" });
    expect(host.lastError?.message).toMatch(/empty/);
  });

  it("lets a spectator claim a bot seat only between hands", () => {
    const host = soloTable();
    const spec = new FakeClient(room, "Spec");
    host.send({ t: "start" });
    spec.send({ t: "sit", seat: 1 });
    expect(spec.lastError?.code).toBe("hand_in_progress");
    runUntil(() => room.phase === "hand-over", 20, 20000, () => host.playIfMyTurn());
    spec.send({ t: "sit", seat: 1 });
    tick();
    expect(spec.state!.you.seat).toBe(1);
  });
});

describe("full hands", () => {
  it("plays a solo hand with three smart bots to a result and starts a fresh hand", () => {
    const host = soloTable();
    const spectator = new FakeClient(room, "Watcher");
    host.send({ t: "start" });
    tick();
    expect(host.state!.me!.hand.length).toBeGreaterThanOrEqual(13);
    runUntil(() => room.phase === "hand-over", 20, 20000, () => host.playIfMyTurn());
    tick();
    expect(host.state!.table!.result).not.toBeNull();
    const firstScores = host.state!.table!.seats.map((s) => s.score);
    host.send({ t: "start" });
    tick();
    const st = host.state!;
    expect(st.table!.handNumber).toBe(2);
    expect(st.table!.dealer).toBe(1);
    expect(st.table!.result).toBeNull();
    // scores carry over (minus any new riichi deposits at most)
    expect(st.table!.seats.map((s) => s.score)).toEqual(firstScores);
    expect(spectator.state!.me).toBeNull();
  });

  it("never sends a private hand to spectators or other seats", () => {
    const host = soloTable();
    const spectator = new FakeClient(room, "Watcher");
    host.send({ t: "start" });
    let checked = 0;
    runUntil(() => room.phase === "hand-over", 20, 20000, () => {
      host.playIfMyTurn();
      const hand = room.hand!;
      if (hand.phase === "ended") return;
      for (const raw of spectator.raw.slice(-3)) {
        const msg = JSON.parse(raw);
        if (msg.t !== "state" || !msg.table) continue;
        expect(msg.me).toBeNull();
        expect(msg.table.revealedHands).toBeNull();
        for (const seat of [0, 1, 2, 3]) expect(raw).not.toContain(JSON.stringify(hand.hands[seat]));
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(10);
  });
});

describe("absent players and timers", () => {
  it("hands a disconnected human's seat to autopilot and returns control on reconnect", () => {
    const host = soloTable();
    host.send({ t: "start" });
    tick();
    host.disconnect();
    tick(AWAY_GRACE_MS + 10);
    expect(room.roomView().seats[0]).toMatchObject({ kind: "human", away: true });
    // autopilot keeps the hand moving without the human
    const v0 = room.hand!.version;
    tick(200);
    expect(room.hand!.version).toBeGreaterThan(v0);
    const back = new FakeClient(room, undefined, host.token);
    tick();
    expect(room.roomView().seats[0]).toMatchObject({ kind: "human", away: false });
    expect(back.state!.you.seat).toBe(0);
  });

  it("makes one autopilot move when a connected human's timer expires", () => {
    const host = soloTable();
    host.send({ t: "start" });
    tick();
    expect(room.hand!.turn).toBe(0); // dealer = seat 0 on hand 1
    const deadline = host.state!.room.deadlines[0];
    expect(deadline).not.toBeNull();
    tick(5000 + 10);
    expect(room.hand!.discards[0].length + (room.hand!.phase === "ended" ? 1 : 0)).toBeGreaterThan(0);
  });
});
