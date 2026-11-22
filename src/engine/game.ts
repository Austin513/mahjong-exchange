// Server-authoritative Riichi hand state machine (reduced ruleset, see docs/RULES.md).
// All functions are deterministic given the seed and the action sequence. State is
// mutated in place for speed (self-play runs thousands of hands); callers that need
// isolation (the room) own their HandState exclusively.

import { makeRng, shuffle } from "./rng";
import { scoreWin, winDeltas, type WinScore } from "./scoring";
import { countKinds, kindOf, nextSeat, seatWind, SEATS, TILE_COUNT, type Seat, type TileId, type TileKind } from "./tiles";
import { shanten, waits } from "./shanten";
import type { Action, ClaimOption, HandConfig, HandState, LegalActions, Meld, Outcome } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

// ---------------------------------------------------------------- setup

export function buildWall(seed: string): TileId[] {
  const tiles = Array.from({ length: TILE_COUNT }, (_, i) => i);
  return shuffle(tiles, makeRng(seed));
}

/**
 * Deal a new hand. `presetWall` (all 136 tiles, draw order) is a fixture hook for
 * replaying known scenarios; normal rooms pass only a fresh random seed.
 */
export function startHand(config: HandConfig, presetWall?: TileId[]): HandState {
  const all = presetWall ? [...presetWall] : buildWall(config.seed);
  if (all.length !== TILE_COUNT || new Set(all).size !== TILE_COUNT) throw new Error("wall must contain each tile once");
  const deadWall = all.splice(all.length - 14, 14);
  const hands: TileId[][] = [[], [], [], []];
  for (let round = 0; round < 13; round++) {
    for (let i = 0; i < 4; i++) hands[nextSeat(config.dealer, i)].push(all.shift()!);
  }
  const s: HandState = {
    config,
    handId: `${config.handNumber}:${config.seed}`,
    wall: all,
    deadWall,
    doraIndicators: [deadWall[4]],
    kanCount: 0,
    hands,
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    riichi: [null, null, null, null],
    tempFuriten: [false, false, false, false],
    riichiFuriten: [false, false, false, false],
    turn: config.dealer,
    phase: "discard",
    drawnTile: null,
    afterKan: false,
    mustDiscard: false,
    kuikaeBan: null,
    claim: null,
    scores: [...config.scores],
    riichiSticks: config.riichiSticks,
    result: null,
    version: 0,
    events: [{ type: "deal", dealer: config.dealer }],
  };
  for (const h of hands) h.sort((a, b) => a - b);
  drawTile(s, config.dealer, false);
  return s;
}

// ---------------------------------------------------------------- helpers

const closedKindCounts = (s: HandState, seat: Seat): number[] => countKinds(s.hands[seat].map(kindOf));
const isClosed = (s: HandState, seat: Seat): boolean => s.melds[seat].every((m) => m.type === "ankan");

export function handShanten(s: HandState, seat: Seat): number {
  return shanten(closedKindCounts(s, seat), s.melds[seat].length);
}

/** Wait kinds for a 13-tile (3n+1) hand. */
export function handWaits(s: HandState, seat: Seat): TileKind[] {
  return waits(closedKindCounts(s, seat), s.melds[seat].length);
}

/** Permanent furiten: one of the seat's waits is in its own discard pile. */
export function isFuriten(s: HandState, seat: Seat): boolean {
  if (s.tempFuriten[seat] || s.riichiFuriten[seat]) return true;
  const w = new Set(handWaits(s, seat));
  return s.discards[seat].some((d) => w.has(kindOf(d.tile)));
}

function drawTile(s: HandState, seat: Seat, rinshan: boolean): void {
  const tile = rinshan ? s.deadWall[s.kanCount - 1] : s.wall.shift()!;
  s.hands[seat].push(tile);
  s.drawnTile = tile;
  s.afterKan = rinshan;
  s.turn = seat;
  s.phase = "discard";
  s.mustDiscard = false;
  s.kuikaeBan = null;
  s.tempFuriten[seat] = false;
  s.events.push({ type: "draw", seat, rinshan });
  s.version++;
}

function winScore(s: HandState, seat: Seat, winTile: TileId, isTsumo: boolean, closedWithWin: TileId[]): WinScore | null {
  const r = s.riichi[seat];
  return scoreWin(closedWithWin, s.melds[seat], winTile, {
    seat,
    dealer: s.config.dealer,
    roundWind: s.config.roundWind,
    seatWind: seatWind(seat, s.config.dealer),
    isTsumo,
    riichi: r !== null,
    ippatsu: r !== null && r.ippatsu,
    haitei: isTsumo && s.wall.length === 0 && !s.afterKan,
    houtei: !isTsumo && s.wall.length === 0,
    rinshan: isTsumo && s.afterKan,
    doraIndicators: s.doraIndicators.map(kindOf),
  });
}

function canTsumo(s: HandState, seat: Seat): boolean {
  if (s.phase !== "discard" || s.turn !== seat || s.drawnTile === null) return false;
  if (shanten(closedKindCounts(s, seat), s.melds[seat].length) !== -1) return false;
  return winScore(s, seat, s.drawnTile, true, s.hands[seat]) !== null;
}

function canRon(s: HandState, seat: Seat, tile: TileId): boolean {
  const c = closedKindCounts(s, seat);
  c[kindOf(tile)]++;
  if (shanten(c, s.melds[seat].length) !== -1) return false;
  if (isFuriten(s, seat)) return false;
  return winScore(s, seat, tile, false, [...s.hands[seat], tile]) !== null;
}

function tilesOfKind(hand: TileId[], k: TileKind): TileId[] {
  return hand.filter((t) => kindOf(t) === k);
}

function legalDiscards(s: HandState, seat: Seat): TileId[] {
  if (s.riichi[seat] && s.drawnTile !== null) return [s.drawnTile];
  const hand = s.hands[seat];
  if (s.kuikaeBan !== null) {
    const allowed = hand.filter((t) => kindOf(t) !== s.kuikaeBan);
    if (allowed.length) return allowed;
  }
  return [...hand];
}

function riichiDiscards(s: HandState, seat: Seat): TileId[] {
  if (s.riichi[seat] || !isClosed(s, seat) || s.scores[seat] < 1000 || s.wall.length < 4 || s.mustDiscard) return [];
  const c = closedKindCounts(s, seat);
  const out: TileId[] = [];
  const seen = new Set<TileKind>();
  for (const t of s.hands[seat]) {
    const k = kindOf(t);
    if (seen.has(k)) {
      if (out.some((o) => kindOf(o) === k)) out.push(t);
      continue;
    }
    seen.add(k);
    c[k]--;
    if (shanten(c, s.melds[seat].length) === 0) out.push(t);
    c[k]++;
  }
  return out;
}

function kanAllowed(s: HandState): boolean {
  return s.kanCount < 4 && s.wall.length > 0;
}

function ankanKinds(s: HandState, seat: Seat): TileKind[] {
  if (s.riichi[seat] || s.mustDiscard || !kanAllowed(s)) return [];
  const c = closedKindCounts(s, seat);
  return c.flatMap((n, k) => (n === 4 ? [k] : []));
}

function kakanKinds(s: HandState, seat: Seat): TileKind[] {
  if (s.mustDiscard || !kanAllowed(s)) return [];
  const c = closedKindCounts(s, seat);
  return s.melds[seat].filter((m) => m.type === "pon" && c[kindOf(m.tiles[0])] > 0).map((m) => kindOf(m.tiles[0]));
}

function claimOptionsFor(s: HandState, seat: Seat, tile: TileId, from: Seat): ClaimOption[] {
  const opts: ClaimOption[] = [];
  if (canRon(s, seat, tile)) opts.push({ type: "ron" });
  // No calls on the final discard (houtei), and no calls while in riichi.
  if (s.riichi[seat] || s.wall.length === 0) return opts;
  const k = kindOf(tile);
  const same = tilesOfKind(s.hands[seat], k);
  if (same.length >= 2) opts.push({ type: "pon", tiles: [same[0], same[1]] });
  if (same.length >= 3 && kanAllowed(s)) opts.push({ type: "minkan" });
  if (seat === nextSeat(from) && k < 27) {
    const r = k % 9;
    const find = (kk: TileKind) => s.hands[seat].find((t) => kindOf(t) === kk);
    const combos: [number, number][] = [[-2, -1], [-1, 1], [1, 2]];
    for (const [a, b] of combos) {
      if (r + a < 0 || r + b > 8) continue;
      const ta = find(k + a), tb = find(k + b);
      if (ta !== undefined && tb !== undefined) opts.push({ type: "chi", tiles: [ta, tb] });
    }
  }
  return opts;
}

// ---------------------------------------------------------------- public API

export function legalActions(s: HandState, seat: Seat): LegalActions {
  const none: LegalActions = { discard: [], riichi: [], tsumo: false, ankan: [], kakan: [], claim: [] };
  if (s.phase === "ended") return none;
  if (s.phase === "claim") {
    const c = s.claim!;
    if (c.responses[seat] !== null) return none;
    return { ...none, claim: c.options[seat] };
  }
  if (s.turn !== seat) return none;
  return {
    discard: legalDiscards(s, seat),
    riichi: riichiDiscards(s, seat),
    tsumo: canTsumo(s, seat),
    ankan: ankanKinds(s, seat),
    kakan: kakanKinds(s, seat),
    claim: [],
  };
}

/** Seats that still owe a response in the current claim window. */
export function pendingClaimants(s: HandState): Seat[] {
  if (s.phase !== "claim" || !s.claim) return [];
  return SEATS.filter((x) => s.claim!.options[x].length > 0 && s.claim!.responses[x] === null);
}

/** Seat whose decision the table is waiting on (discard turn), if any. */
export function actingSeats(s: HandState): Seat[] {
  if (s.phase === "ended") return [];
  if (s.phase === "claim") return pendingClaimants(s);
  return [s.turn];
}

export function outcomeOf(s: HandState): Outcome | null {
  if (!s.result) return null;
  return s.result.type === "win" ? s.result.winner : "draw";
}

export function applyAction(s: HandState, seat: Seat, a: Action): ActionResult {
  if (s.phase === "ended") return fail("The hand is over.");
  if (s.phase === "claim") return applyClaim(s, seat, a);
  if (seat !== s.turn) return fail("It is not your turn.");
  switch (a.type) {
    case "discard":
      return discard(s, seat, a.tile, a.riichi === true);
    case "tsumo":
      if (!canTsumo(s, seat)) return fail("Tsumo is not available: the hand is not a complete hand with a yaku.");
      finishWin(s, seat, null, s.drawnTile!);
      return OK;
    case "ankan":
      return ankan(s, seat, a.kind);
    case "kakan":
      return kakan(s, seat, a.kind);
    default:
      return fail("That action is only valid when claiming a discard.");
  }
}

function discard(s: HandState, seat: Seat, tile: TileId, riichi: boolean): ActionResult {
  const allowed = riichi ? riichiDiscards(s, seat) : legalDiscards(s, seat);
  if (!allowed.includes(tile)) {
    if (riichi) return fail("Riichi is not available with that discard (hand must be closed and tenpai, 1000+ points, 4+ tiles left).");
    if (!s.hands[seat].includes(tile)) return fail("That tile is not in your hand.");
    if (s.riichi[seat]) return fail("After riichi you must discard the tile you drew.");
    return fail("You cannot discard the same kind of tile you just called.");
  }
  const tsumogiri = tile === s.drawnTile;
  s.hands[seat].splice(s.hands[seat].indexOf(tile), 1);
  s.hands[seat].sort((a, b) => a - b);
  const r = s.riichi[seat];
  if (r) r.ippatsu = false; // ippatsu window closes at the riichi player's next discard
  if (riichi) {
    s.riichi[seat] = { discardIndex: s.discards[seat].length, ippatsu: true };
    s.scores[seat] -= 1000;
    s.riichiSticks += 1;
  }
  s.discards[seat].push({ tile, tsumogiri, riichi, calledBy: null });
  s.drawnTile = null;
  s.afterKan = false;
  s.mustDiscard = false;
  s.kuikaeBan = null;
  s.events.push({ type: "discard", seat, tile, tsumogiri, riichi });
  s.version++;
  openClaimWindow(s, seat, tile);
  return OK;
}

function openClaimWindow(s: HandState, from: Seat, tile: TileId): void {
  const options: ClaimOption[][] = [[], [], [], []];
  let any = false;
  for (const seat of SEATS) {
    if (seat === from) continue;
    options[seat] = claimOptionsFor(s, seat, tile, from);
    if (options[seat].length) any = true;
  }
  if (!any) return advanceAfterDiscard(s, from);
  s.claim = { tile, from, options, responses: [null, null, null, null] };
  s.phase = "claim";
  s.version++;
}

function advanceAfterDiscard(s: HandState, from: Seat): void {
  s.claim = null;
  if (s.wall.length === 0) return finishExhaustive(s);
  drawTile(s, nextSeat(from), false);
}

function applyClaim(s: HandState, seat: Seat, a: Action): ActionResult {
  const c = s.claim!;
  const opts = c.options[seat];
  if (opts.length === 0) return fail("You have no claim on this discard.");
  if (c.responses[seat] !== null) return fail("You already responded to this discard.");
  if (a.type !== "pass") {
    if ((a.type === "chi" || a.type === "pon") && a.tiles[0] === a.tiles[1]) return fail("Choose two different tiles.");
    const match = opts.find((o) => {
      if (o.type !== a.type) return false;
      if ((o.type === "chi" || o.type === "pon") && (a.type === "chi" || a.type === "pon")) {
        const want = [...a.tiles].map(kindOf).sort().join();
        const have = [...o.tiles].map(kindOf).sort().join();
        return want === have && a.tiles.every((t) => s.hands[seat].includes(t));
      }
      return true;
    });
    if (!match) return fail("That claim is not available on this discard.");
  }
  c.responses[seat] = a;
  s.version++;
  if (pendingClaimants(s).length === 0) resolveClaims(s);
  return OK;
}

function resolveClaims(s: HandState): void {
  const c = s.claim!;
  const order: Seat[] = [1, 2, 3].map((i) => nextSeat(c.from, i));
  // Anyone who could ron and did not get the win is now furiten.
  for (const seat of order) {
    if (c.options[seat].some((o) => o.type === "ron") && c.responses[seat]?.type !== "ron") {
      s.tempFuriten[seat] = true;
      if (s.riichi[seat]) s.riichiFuriten[seat] = true;
    }
  }
  // Ron: head bump. First ron claimant counter-clockwise from the discarder wins.
  const ron = order.find((x) => c.responses[x]?.type === "ron");
  if (ron !== undefined) return finishWin(s, ron, c.from, c.tile);
  const kanOrPon = order.find((x) => c.responses[x]?.type === "pon" || c.responses[x]?.type === "minkan");
  if (kanOrPon !== undefined) return callMeld(s, kanOrPon, c.responses[kanOrPon]!);
  const chi = order.find((x) => c.responses[x]?.type === "chi");
  if (chi !== undefined) return callMeld(s, chi, c.responses[chi]!);
  advanceAfterDiscard(s, c.from);
}

function breakIppatsu(s: HandState): void {
  for (const r of s.riichi) if (r) r.ippatsu = false;
}

function callMeld(s: HandState, seat: Seat, a: Action): void {
  const c = s.claim!;
  const tile = c.tile;
  const hand = s.hands[seat];
  let own: TileId[];
  let type: Meld["type"];
  if (a.type === "minkan") {
    own = tilesOfKind(hand, kindOf(tile)).slice(0, 3);
    type = "minkan";
  } else if (a.type === "pon" || a.type === "chi") {
    own = [...a.tiles];
    type = a.type;
  } else throw new Error("not a meld call");
  for (const t of own) hand.splice(hand.indexOf(t), 1);
  const meld: Meld = { type, tiles: [...own, tile].sort((x, y) => x - y), called: tile, from: c.from };
  s.melds[seat].push(meld);
  const pile = s.discards[c.from];
  pile[pile.length - 1].calledBy = seat;
  breakIppatsu(s);
  s.claim = null;
  s.turn = seat;
  s.events.push({ type: "call", seat, meld });
  s.version++;
  if (type === "minkan") return kanDraw(s, seat);
  s.phase = "discard";
  s.drawnTile = null;
  s.afterKan = false;
  s.mustDiscard = true;
  s.kuikaeBan = kindOf(tile);
}

function kanDraw(s: HandState, seat: Seat): void {
  s.kanCount++;
  // The dead wall stays 14 tiles: the last live tile moves to the back of the dead wall.
  s.deadWall.push(s.wall.pop()!);
  const indicator = s.deadWall[4 + s.kanCount];
  s.doraIndicators.push(indicator);
  s.events.push({ type: "dora", indicator });
  drawTile(s, seat, true);
}

function ankan(s: HandState, seat: Seat, kind: TileKind): ActionResult {
  if (!ankanKinds(s, seat).includes(kind)) return fail("Closed kan is not available for that tile.");
  const tiles = tilesOfKind(s.hands[seat], kind);
  for (const t of tiles) s.hands[seat].splice(s.hands[seat].indexOf(t), 1);
  const meld: Meld = { type: "ankan", tiles };
  s.melds[seat].push(meld);
  breakIppatsu(s);
  s.events.push({ type: "call", seat, meld });
  kanDraw(s, seat);
  return OK;
}

function kakan(s: HandState, seat: Seat, kind: TileKind): ActionResult {
  if (!kakanKinds(s, seat).includes(kind)) return fail("Added kan is not available for that tile.");
  const tile = tilesOfKind(s.hands[seat], kind)[0];
  s.hands[seat].splice(s.hands[seat].indexOf(tile), 1);
  const meld = s.melds[seat].find((m) => m.type === "pon" && kindOf(m.tiles[0]) === kind)!;
  meld.type = "kakan";
  meld.tiles = [...meld.tiles, tile];
  breakIppatsu(s);
  s.events.push({ type: "call", seat, meld: { ...meld, tiles: [...meld.tiles] } });
  kanDraw(s, seat);
  return OK;
}

function finishWin(s: HandState, winner: Seat, from: Seat | null, winTile: TileId): void {
  const closed = from === null ? s.hands[winner] : [...s.hands[winner], winTile];
  const score = winScore(s, winner, winTile, from === null, closed);
  if (!score) throw new Error("finishWin called on a non-winning hand");
  if (from !== null) {
    s.hands[winner].push(winTile);
    const pile = s.discards[from];
    pile[pile.length - 1].calledBy = winner; // the ron tile moves to the winner's hand
  }
  const deltas = winDeltas(score.payment, winner, from, s.config.dealer, s.riichiSticks);
  for (let i = 0; i < 4; i++) s.scores[i] += deltas[i];
  const points = deltas[winner] - s.riichiSticks * 1000;
  s.riichiSticks = 0;
  s.result = { type: "win", winner, from, winTile, han: score.han, fu: score.fu, yaku: score.yaku, dora: score.dora, points, deltas };
  s.phase = "ended";
  s.claim = null;
  s.events.push({ type: "win", seat: winner, from });
  s.version++;
}

function finishExhaustive(s: HandState): void {
  const tenpai = SEATS.filter((x) => handShanten(s, x) === 0);
  const deltas = [0, 0, 0, 0];
  if (tenpai.length > 0 && tenpai.length < 4) {
    for (const x of SEATS) deltas[x] = tenpai.includes(x) ? 3000 / tenpai.length : -3000 / (4 - tenpai.length);
  }
  for (let i = 0; i < 4; i++) s.scores[i] += deltas[i];
  s.result = { type: "draw", tenpai, deltas };
  s.phase = "ended";
  s.claim = null;
  s.events.push({ type: "exhaustive" });
  s.version++;
}

/** Every physical tile currently on the table. Must always be 136 unique ids. */
export function tileCensus(s: HandState): TileId[] {
  const all: TileId[] = [...s.wall, ...s.deadWall.slice(s.kanCount)];
  for (const h of s.hands) all.push(...h);
  for (const ms of s.melds) for (const m of ms) all.push(...m.tiles);
  for (const ds of s.discards) for (const d of ds) if (d.calledBy === null) all.push(d.tile);
  return all;
}
