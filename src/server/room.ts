// Room orchestration: membership, sessions, seats, hand lifecycle, table bots,
// timers, and broadcasting per-recipient views. Every command runs synchronously
// to completion on Node's single thread, so commands are serialised per room and a
// hand's final action and its follow-up (settlement, in PR 2) cannot interleave with
// any other command.

import { randomBytes } from "node:crypto";
import { actingSeats, applyAction, outcomeOf, startHand } from "../engine/game";
import type { Action, HandState, PublicEvent } from "../engine/types";
import { privateInfo, publicView, seatView } from "../engine/views";
import { EAST, kindLabel, kindOf, type Seat } from "../engine/tiles";
import { chooseAction } from "../bots/mahjong/smart";
import { randomAction } from "../bots/mahjong/random";
import { makeRng, type Rng } from "../engine/rng";
import {
  DEFAULT_SETTINGS,
  seatName,
  type ClientMessage,
  type FeedItem,
  type GameMode,
  type RoomSettings,
  type SettingsPatch,
  type RoomView,
  type ServerMessage,
  type TableBotKind,
  type YouView,
} from "../shared/protocol";

export interface Conn {
  id: string;
  send(data: string): void;
  participantId: string | null;
}

interface Participant {
  id: string;
  name: string;
  token: string;
  conns: Set<Conn>;
  joinedAt: number;
  /** Set when the last connection drops; cleared on reconnect. */
  disconnectedAt: number | null;
}

type Occupant =
  | { kind: "human"; participantId: string; away: boolean }
  | { kind: "bot"; bot: TableBotKind; name: string };

const BOT_NAMES = ["Kestrel", "Heron", "Lotus", "Pine", "Crane", "Bamboo", "Plum", "Orchid"];
export const AWAY_GRACE_MS = 3000;
const HOST_HANDOFF_MS = 30000;

export interface RoomOptions {
  code: string;
  mode: GameMode;
  /** Fixture path: deterministic walls (`${seed}-${handNumber}`). Dev/test only. */
  seed?: string;
  settings?: Partial<RoomSettings>;
}

export class Room {
  readonly code: string;
  readonly mode: GameMode;
  readonly seed: string | null;
  settings: RoomSettings;
  phase: RoomView["phase"] = "lobby";
  hostId = "";
  handNumber = 0;
  hand: HandState | null = null;
  scores = [25000, 25000, 25000, 25000];
  riichiSticks = 0;
  lastActivity = Date.now();

  private participants = new Map<string, Participant>();
  private byToken = new Map<string, string>();
  private seats: (Occupant | null)[] = [null, null, null, null];
  private feed: FeedItem[] = [];
  private feedId = 0;
  private decisionTimers = new Map<Seat, { version: number; at: number | null; timer: ReturnType<typeof setTimeout> }>();
  private awayTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPending = false;
  private botRng: Rng;
  private eventCursor = 0;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.mode = opts.mode;
    this.seed = opts.seed ?? null;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings, tradingBots: { ...DEFAULT_SETTINGS.tradingBots, ...opts.settings?.tradingBots } };
    this.botRng = makeRng(`${opts.seed ?? randomBytes(8).toString("hex")}-bots`);
  }

  // ------------------------------------------------------------ membership

  /** Create a participant (spectator) and return its private session token. */
  addParticipant(name: string): Participant {
    const p: Participant = {
      id: randomBytes(6).toString("base64url"),
      name: sanitizeName(name) || "Guest",
      token: randomBytes(16).toString("base64url"),
      conns: new Set(),
      joinedAt: Date.now(),
      disconnectedAt: Date.now(),
    };
    this.participants.set(p.id, p);
    this.byToken.set(p.token, p.id);
    if (!this.hostId) this.hostId = p.id;
    this.pushFeed("room", `${p.name} joined`);
    this.touch();
    return p;
  }

  /** Attach a connection. A valid token reattaches the same identity; otherwise a name creates one. */
  attach(conn: Conn, token: string | undefined, name: string | undefined): { ok: true; participant: Participant } | { ok: false; code: string; message: string } {
    let p: Participant | undefined;
    if (token) {
      const id = this.byToken.get(token);
      if (id) p = this.participants.get(id);
    }
    if (!p) {
      if (!name || !sanitizeName(name)) {
        return { ok: false, code: "name_required", message: "Enter a display name to join this room." };
      }
      p = this.addParticipant(name);
    }
    conn.participantId = p.id;
    p.conns.add(conn);
    const wasAway = p.disconnectedAt !== null;
    p.disconnectedAt = null;
    const t = this.awayTimers.get(p.id);
    if (t) clearTimeout(t);
    this.awayTimers.delete(p.id);
    const seat = this.seatOf(p.id);
    if (seat !== null) {
      const occ = this.seats[seat];
      if (occ?.kind === "human" && occ.away) {
        occ.away = false;
        this.pushFeed("room", `${p.name} is back and has control of ${seatName(seat)}`);
      }
      if (wasAway) this.scheduleDecisions();
    }
    if (this.hostId === p.id && this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    this.send(conn, { t: "welcome", token: p.token, participantId: p.id, room: this.code });
    this.touch();
    this.markDirty();
    return { ok: true, participant: p };
  }

  detach(conn: Conn): void {
    const p = conn.participantId ? this.participants.get(conn.participantId) : undefined;
    if (!p) return;
    p.conns.delete(conn);
    if (p.conns.size > 0) return;
    p.disconnectedAt = Date.now();
    const seat = this.seatOf(p.id);
    if (seat !== null) {
      // Absent-player rule: after a short grace period a smart bot plays the seat.
      this.awayTimers.set(
        p.id,
        setTimeout(() => {
          this.awayTimers.delete(p.id);
          const occ = this.seats[seat];
          if (occ?.kind === "human" && occ.participantId === p.id && p.conns.size === 0) {
            occ.away = true;
            this.pushFeed("room", `${p.name} disconnected — autopilot is playing ${seatName(seat)} until they return`);
            this.scheduleDecisions();
            this.markDirty();
          }
        }, AWAY_GRACE_MS),
      );
    }
    if (this.hostId === p.id) {
      this.hostTimer = setTimeout(() => this.handOffHost(), HOST_HANDOFF_MS);
    }
    this.markDirty();
  }

  private handOffHost(): void {
    this.hostTimer = null;
    const host = this.participants.get(this.hostId);
    if (host && host.conns.size > 0) return;
    const next = [...this.participants.values()].filter((p) => p.conns.size > 0).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      this.hostId = next.id;
      this.pushFeed("room", `${next.name} is now the host`);
      this.markDirty();
    }
  }

  connectionCount(): number {
    let n = 0;
    for (const p of this.participants.values()) n += p.conns.size;
    return n;
  }

  // ------------------------------------------------------------ commands

  handle(conn: Conn, msg: ClientMessage): void {
    const p = conn.participantId ? this.participants.get(conn.participantId) : undefined;
    if (!p) return this.error(conn, "not_joined", "Join the room first.");
    this.touch();
    const err = this.dispatch(p, msg);
    if (err) this.error(conn, err.code, err.message);
  }

  /** Returns an error for the caller, or null on success. Protected for PR 2 extension. */
  protected dispatch(p: Participant, msg: ClientMessage): { code: string; message: string } | null {
    switch (msg.t) {
      case "sit":
        return this.sit(p, msg.seat as Seat);
      case "stand":
        return this.stand(p);
      case "addBot":
        return this.hostOnly(p) ?? this.addBot(msg.seat as Seat, msg.bot);
      case "removeBot":
        return this.hostOnly(p) ?? this.removeBot(msg.seat as Seat);
      case "settings":
        return this.hostOnly(p) ?? this.updateSettings(msg.settings);
      case "start":
        return this.hostOnly(p) ?? this.startNextHand();
      case "act":
        return this.humanAct(p, msg.handId, msg.action as Action);
      case "ping":
        return null;
      case "hello":
        return { code: "already_joined", message: "Already joined." };
      default:
        return { code: "unsupported", message: "That command is not available in this room." };
    }
  }

  private hostOnly(p: Participant) {
    return p.id === this.hostId ? null : { code: "not_host", message: "Only the host can do that." };
  }

  private betweenHands(): boolean {
    return this.phase !== "playing";
  }

  seatOf(participantId: string): Seat | null {
    const i = this.seats.findIndex((o) => o?.kind === "human" && o.participantId === participantId);
    return i < 0 ? null : (i as Seat);
  }

  private sit(p: Participant, seat: Seat) {
    if (!this.betweenHands()) return { code: "hand_in_progress", message: "Seats can be claimed between hands. You can watch and trade until this hand ends." };
    if (this.seatOf(p.id) !== null) return { code: "already_seated", message: "You already hold a seat. Stand up first to switch seats." };
    const occ = this.seats[seat];
    if (occ?.kind === "human") return { code: "seat_taken", message: `${seatName(seat)} is taken. Pick an empty or bot seat.` };
    this.seats[seat] = { kind: "human", participantId: p.id, away: false };
    this.pushFeed("room", `${p.name} sat at ${seatName(seat)}${occ ? ` (replacing ${occ.name})` : ""}`);
    this.onSeatsChanged();
    this.markDirty();
    return null;
  }

  private stand(p: Participant) {
    const seat = this.seatOf(p.id);
    if (seat === null) return { code: "not_seated", message: "You are not seated." };
    if (!this.betweenHands()) return { code: "hand_in_progress", message: "You can leave your seat after this hand ends." };
    this.seats[seat] = null;
    this.pushFeed("room", `${p.name} left ${seatName(seat)}`);
    this.onSeatsChanged();
    this.markDirty();
    return null;
  }

  private addBot(seat: Seat, bot: TableBotKind) {
    if (!this.betweenHands()) return { code: "hand_in_progress", message: "Bots can be added between hands." };
    if (this.seats[seat]) return { code: "seat_taken", message: `${seatName(seat)} is not empty.` };
    const used = new Set(this.seats.flatMap((o) => (o?.kind === "bot" ? [o.name] : [])));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat + 1}`;
    this.seats[seat] = { kind: "bot", bot, name };
    this.pushFeed("room", `Host added ${bot === "smart" ? "smart" : "random"} table bot ${name} at ${seatName(seat)}`);
    this.onSeatsChanged();
    this.markDirty();
    return null;
  }

  private removeBot(seat: Seat) {
    if (!this.betweenHands()) return { code: "hand_in_progress", message: "Bots can be removed between hands." };
    if (this.seats[seat]?.kind !== "bot") return { code: "no_bot", message: `${seatName(seat)} has no bot.` };
    this.seats[seat] = null;
    this.onSeatsChanged();
    this.markDirty();
    return null;
  }

  private updateSettings(s: SettingsPatch) {
    this.settings = { ...this.settings, ...s, tradingBots: { ...this.settings.tradingBots, ...s.tradingBots } };
    this.onSettingsChanged();
    this.markDirty();
    return null;
  }

  /** Hook for subclasses (trading bots depend on seats/settings). */
  protected onSeatsChanged(): void {}
  protected onSettingsChanged(): void {}

  startNextHand() {
    if (!this.betweenHands()) return { code: "hand_in_progress", message: "A hand is already in progress." };
    const empty = this.seats.findIndex((o) => o === null);
    if (empty >= 0) return { code: "seats_empty", message: `${seatName(empty)} is empty. Fill every seat with a player or a table bot to start.` };
    this.handNumber++;
    const dealer = ((this.handNumber - 1) % 4) as Seat;
    const roundWind = EAST + (Math.floor((this.handNumber - 1) / 4) % 4);
    const seed = this.seed ? `${this.seed}-${this.handNumber}` : randomBytes(16).toString("hex");
    this.hand = startHand({ seed, handNumber: this.handNumber, dealer, roundWind, scores: [...this.scores], riichiSticks: this.riichiSticks });
    this.eventCursor = 0;
    this.phase = "playing";
    this.onHandStarted(this.hand);
    this.afterTableChange();
    return null;
  }

  protected onHandStarted(_hand: HandState): void {}
  /** Called synchronously in the same command that made the outcome final. */
  protected onHandEnded(_hand: HandState): void {}
  /** Called after every table state change (public information may have changed). */
  protected onTableChanged(_hand: HandState, _events: PublicEvent[]): void {}

  private humanAct(p: Participant, handId: string, action: Action) {
    const seat = this.seatOf(p.id);
    if (seat === null) return { code: "not_seated", message: "Spectators cannot make table moves. Claim a seat between hands to play." };
    if (!this.hand || this.hand.handId !== handId) return { code: "stale_hand", message: "That move was for a previous hand. The table has been refreshed." };
    return this.applySeatAction(seat, action);
  }

  /** Single entry point for table moves from humans, bots, and autopilot. */
  applySeatAction(seat: Seat, action: Action): { code: string; message: string } | null {
    const hand = this.hand;
    if (!hand || this.phase !== "playing") return { code: "no_hand", message: "No hand is in progress." };
    const r = applyAction(hand, seat, action);
    if (!r.ok) return { code: "illegal_move", message: r.error };
    this.afterTableChange();
    return null;
  }

  private afterTableChange(): void {
    const hand = this.hand!;
    const fresh = hand.events.slice(this.eventCursor);
    this.eventCursor = hand.events.length;
    for (const e of fresh) this.feedTableEvent(e);
    if (hand.phase === "ended") {
      // Atomic close: scores roll forward and the market settles in this same call.
      this.scores = [...hand.scores];
      this.riichiSticks = hand.riichiSticks;
      this.phase = "hand-over";
      this.clearDecisionTimers();
      this.onHandEnded(hand);
    } else {
      this.onTableChanged(hand, fresh);
      this.scheduleDecisions();
    }
    this.markDirty();
  }

  // ------------------------------------------------------------ decisions & timers

  /** Who decides for a seat right now. */
  private controller(seat: Seat): "human" | "bot" | "autopilot" {
    const occ = this.seats[seat];
    if (!occ || occ.kind === "bot") return "bot";
    return occ.away ? "autopilot" : "human";
  }

  private scheduleDecisions(): void {
    const hand = this.hand;
    if (!hand || hand.phase === "ended") return;
    const acting = new Set(actingSeats(hand));
    for (const [seat, t] of this.decisionTimers) {
      if (!acting.has(seat) || t.version !== hand.version) {
        clearTimeout(t.timer);
        this.decisionTimers.delete(seat);
      }
    }
    for (const seat of acting) {
      const existing = this.decisionTimers.get(seat);
      const ctl = this.controller(seat);
      if (existing && existing.version === hand.version && (existing.at === null) === (ctl !== "human")) continue;
      if (existing) clearTimeout(existing.timer);
      const version = hand.version;
      if (ctl === "human") {
        const secs = hand.phase === "claim" ? this.settings.claimSeconds : this.settings.turnSeconds;
        const at = Date.now() + secs * 1000;
        const timer = setTimeout(() => this.autoDecide(seat, version, "timeout"), secs * 1000);
        this.decisionTimers.set(seat, { version, at, timer });
      } else {
        const timer = setTimeout(() => this.autoDecide(seat, version, ctl), this.settings.botDelayMs);
        this.decisionTimers.set(seat, { version, at: null, timer });
      }
    }
  }

  private autoDecide(seat: Seat, version: number, why: "bot" | "autopilot" | "timeout"): void {
    const hand = this.hand;
    this.decisionTimers.delete(seat);
    if (!hand || hand.version !== version || !actingSeats(hand).includes(seat)) return;
    const occ = this.seats[seat];
    const view = seatView(hand, seat);
    const action = occ?.kind === "bot" && occ.bot === "random" ? randomAction(view, this.botRng) : chooseAction(view);
    if (why === "timeout" && occ?.kind === "human") {
      const name = this.participants.get(occ.participantId)?.name ?? seatName(seat);
      this.pushFeed("room", `${name}'s timer expired — autopilot made one move`);
    }
    const err = this.applySeatAction(seat, action);
    if (err) {
      // Should never happen (bots choose from legal actions); fail safe instead of stalling.
      console.error(`[room ${this.code}] bot move rejected: ${err.message}`);
      const legal = view.me.legal;
      this.applySeatAction(seat, legal.claim.length ? { type: "pass" } : { type: "discard", tile: legal.discard[0] });
    }
  }

  private clearDecisionTimers(): void {
    for (const t of this.decisionTimers.values()) clearTimeout(t.timer);
    this.decisionTimers.clear();
  }

  // ------------------------------------------------------------ feed

  protected pushFeed(kind: FeedItem["kind"], text: string): void {
    this.feed.push({ id: ++this.feedId, at: Date.now(), kind, text });
    if (this.feed.length > 60) this.feed.splice(0, this.feed.length - 60);
  }

  protected seatLabel(seat: Seat): string {
    const occ = this.seats[seat];
    const who = !occ ? "empty" : occ.kind === "bot" ? occ.name : (this.participants.get(occ.participantId)?.name ?? "?");
    return `${seatName(seat)} (${who})`;
  }

  private feedTableEvent(e: PublicEvent): void {
    switch (e.type) {
      case "deal":
        this.pushFeed("table", `Hand ${this.handNumber} dealt — ${this.seatLabel(e.dealer)} is dealer`);
        break;
      case "discard":
        if (e.riichi) this.pushFeed("table", `${this.seatLabel(e.seat)} declared RIICHI discarding ${kindLabel(kindOf(e.tile))}`);
        break;
      case "call":
        this.pushFeed("table", `${this.seatLabel(e.seat)} called ${e.meld.type.toUpperCase()} (${e.meld.tiles.map((t) => kindLabel(kindOf(t))).join(" ")})`);
        break;
      case "win":
        this.pushFeed("table", `${this.seatLabel(e.seat)} won by ${e.from === null ? "TSUMO" : `RON off ${this.seatLabel(e.from)}`}`);
        break;
      case "exhaustive":
        this.pushFeed("table", "Wall exhausted — the hand is a DRAW");
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ views & broadcast

  protected touch(): void {
    this.lastActivity = Date.now();
  }

  markDirty(): void {
    if (this.flushPending) return;
    this.flushPending = true;
    setImmediate(() => {
      this.flushPending = false;
      this.flush();
    });
  }

  roomView(): RoomView {
    const participants = [...this.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.conns.size > 0,
      seat: this.seatOf(p.id),
      isHost: p.id === this.hostId,
      isBot: false,
    }));
    const deadlines = [0, 1, 2, 3].map((s) => this.decisionTimers.get(s as Seat)?.at ?? null);
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      seats: this.seats.map((o) => {
        if (!o) return null;
        if (o.kind === "bot") return { kind: "bot", bot: o.bot, name: o.name };
        const p = this.participants.get(o.participantId)!;
        return { kind: "human", participantId: p.id, name: p.name, connected: p.conns.size > 0, away: o.away };
      }),
      // Bounded payload: everyone seated plus the host, then the first spectators by join order.
      participants: [...participants.filter((p) => p.seat !== null || p.isHost), ...participants.filter((p) => p.seat === null && !p.isHost).slice(0, 24)],
      spectatorCount: participants.filter((p) => p.seat === null).length,
      handNumber: this.handNumber,
      seeded: this.seed !== null,
      deadlines,
      feed: this.feed.slice(-25),
      serverNow: Date.now(),
    };
  }

  protected youView(p: Participant): YouView {
    return { participantId: p.id, name: p.name, seat: this.seatOf(p.id), isHost: p.id === this.hostId, canTrade: false, tradeBlockedReason: "Trading arrives with the market." };
  }

  /** Extra top-level fields for the state message (market in PR 2). Must return a JSON object fragment string. */
  protected extraState(_p: Participant): string {
    return ',"market":null';
  }

  flush(): void {
    const room = JSON.stringify(this.roomView());
    const table = this.hand ? JSON.stringify(publicView(this.hand)) : "null";
    for (const p of this.participants.values()) {
      if (p.conns.size === 0) continue;
      const seat = this.seatOf(p.id);
      const me = this.hand && seat !== null ? JSON.stringify(privateInfo(this.hand, seat)) : "null";
      const extra = this.extraState(p);
      const msg = `{"t":"state","room":${room},"table":${table},"me":${me},"you":${JSON.stringify(this.youView(p))}${extra}}`;
      for (const c of p.conns) c.send(msg);
    }
  }

  protected send(conn: Conn, msg: ServerMessage): void {
    conn.send(JSON.stringify(msg));
  }

  protected error(conn: Conn, code: string, message: string): void {
    this.send(conn, { t: "error", code, message });
  }

  notifyParticipant(participantId: string, text: string): void {
    const p = this.participants.get(participantId);
    if (p) for (const c of p.conns) this.send(c, { t: "notice", text });
  }

  participantName(id: string): string {
    return this.participants.get(id)?.name ?? "?";
  }

  protected occupant(seat: Seat): Occupant | null {
    return this.seats[seat];
  }

  protected allParticipants(): Participant[] {
    return [...this.participants.values()];
  }

  outcome() {
    return this.hand ? outcomeOf(this.hand) : null;
  }

  dispose(): void {
    this.clearDecisionTimers();
    for (const t of this.awayTimers.values()) clearTimeout(t);
    if (this.hostTimer) clearTimeout(this.hostTimer);
  }
}

export type { Participant, Occupant };

export function sanitizeName(name: string): string {
  return [...name].filter((ch) => ch.charCodeAt(0) >= 32 && ch !== "<" && ch !== ">").join("").trim().slice(0, 24);
}
