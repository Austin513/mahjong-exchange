// Room registry. Rooms are in memory (see docs/PLAN.md "Persistence strategy").

import { randomInt } from "node:crypto";
import { Room, type RoomOptions } from "./room";
import type { GameMode } from "../shared/protocol";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  constructor(private factory: (opts: RoomOptions) => Room = (o) => new Room(o)) {}

  create(mode: GameMode, seed?: string): Room {
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room = this.factory({ code, mode, seed });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  size(): number {
    return this.rooms.size;
  }

  /** Remove rooms with no connections and no activity for IDLE_ROOM_MS. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.connectionCount() === 0 && now - room.lastActivity > IDLE_ROOM_MS) {
        room.dispose();
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  disposeAll(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }
}

export const normalizeCode = (code: string): string => code.trim().toUpperCase();
