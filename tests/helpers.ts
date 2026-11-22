import { vi } from "vitest";
import type { Conn, Room } from "../src/server/room";
import type { ServerMessage, StateMessage } from "../src/shared/protocol";
import type { ClientMessage } from "../src/shared/protocol";
import { chooseAction } from "../src/bots/mahjong/smart";
import type { SeatView } from "../src/engine/views";

export class FakeClient {
  conn: Conn;
  messages: ServerMessage[] = [];
  raw: string[] = [];
  token = "";
  participantId = "";
  attachResult: ReturnType<Room["attach"]>;
  constructor(public room: Room, name?: string, token?: string) {
    this.conn = {
      id: Math.random().toString(36).slice(2),
      participantId: null,
      send: (d: string) => {
        this.raw.push(d);
        const m = JSON.parse(d) as ServerMessage;
        this.messages.push(m);
        if (m.t === "welcome") {
          this.token = m.token;
          this.participantId = m.participantId;
        }
      },
    };
    this.attachResult = room.attach(this.conn, token, name);
  }
  send(msg: ClientMessage) {
    this.room.handle(this.conn, msg);
  }
  get state(): StateMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.t === "state") return m;
    }
    return undefined;
  }
  get lastError() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.t === "error") return m;
    }
    return undefined;
  }
  disconnect() {
    this.room.detach(this.conn);
  }
  /** Plays the client's pending table decision with the smart policy, as a human would. */
  playIfMyTurn(): boolean {
    const s = this.state;
    if (!s?.me || !s.table || s.table.phase === "ended") return false;
    const legal = s.me.legal;
    if (!legal.discard.length && !legal.claim.length && !legal.tsumo) return false;
    const view = { ...s.table, me: s.me } as SeatView;
    this.send({ t: "act", handId: s.table.handId, action: chooseAction(view) });
    return true;
  }
}

export const tick = (ms = 1) => vi.advanceTimersByTime(ms);

/** Advance time until `done()` or the step budget runs out. */
export function runUntil(done: () => boolean, step = 20, maxSteps = 20000, each?: () => void) {
  for (let i = 0; i < maxSteps && !done(); i++) {
    each?.();
    vi.advanceTimersByTime(step);
  }
  if (!done()) throw new Error("condition not reached");
}
