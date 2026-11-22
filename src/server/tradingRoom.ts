// Open Exchange trading bots. Each bot has its own visible identity and ledger account,
// acts at a bounded configurable pace, and submits orders through MarketRoom.submitOrder
// — the same execution and collateral path as a human. Trading bots exist only in Open
// Exchange; House-mode liquidity is the house's job.

import { MarketRoom } from "./marketRoom";
import type { RoomOptions } from "./room";
import { makeRng, type Rng } from "../engine/rng";
import { publicView } from "../engine/views";
import { outcomeProbabilities } from "../pricing/model";
import { privateFeatures } from "../pricing/dataset";
import { CONTRACTS, type ContractId } from "../market/types";
import { BOT_DESCRIPTIONS, informedPolicy, noisePolicy, publicPolicy, randomPolicy, type BotAction, type BotSnapshot, type NoiseState, type TradingBotKind } from "../bots/trading/policies";
import { seatName, TRADING_BOT_KINDS } from "../shared/protocol";
import type { BotView, MarketShared } from "../shared/market";
import type { HandState } from "../engine/types";
import type { Seat } from "../engine/tiles";

interface TradingBot {
  id: string;
  kind: TradingBotKind;
  index: number;
  name: string;
  attachedSeat: number | null;
  rng: Rng;
  noise: NoiseState;
  timer: ReturnType<typeof setTimeout> | null;
  lastReason: string | null;
}

export class TradingRoom extends MarketRoom {
  private bots: TradingBot[] = [];
  private setupNote: string | null = null;
  /** Count of decisions per bot kind (diagnostics/tests). */
  decisions: Record<TradingBotKind, number> = { informed: 0, public: 0, noise: 0, random: 0 };

  constructor(opts: RoomOptions) {
    super(opts);
    this.reconcileBots();
  }

  protected override onSeatsChanged(): void {
    this.reconcileBots();
  }

  protected override onSettingsChanged(): void {
    this.reconcileBots();
  }

  protected override onHandStarted(hand: HandState): void {
    super.onHandStarted(hand);
    this.reconcileBots();
    for (const b of this.bots) this.scheduleBot(b, true);
  }

  protected override onHandEnded(hand: HandState): void {
    this.stopBots();
    super.onHandEnded(hand);
  }

  /** Build the bot roster from settings; informed bots attach to bot-controlled seats only. */
  private reconcileBots(): void {
    if (this.mode !== "exchange") {
      this.setupNote = null;
      return;
    }
    const want = this.settings.tradingBots;
    const botSeats = ([0, 1, 2, 3] as Seat[]).filter((s) => this.occupant(s)?.kind === "bot");
    const next: TradingBot[] = [];
    let note: string | null = null;
    for (const kind of TRADING_BOT_KINDS) {
      for (let i = 1; i <= want[kind]; i++) {
        let attachedSeat: number | null = null;
        if (kind === "informed") {
          if (i > botSeats.length) {
            note =
              botSeats.length === 0
                ? "Informed bots need a seat played by a table bot — they read that bot's tiles and never a human's. Add a table bot to enable them."
                : `Only ${botSeats.length} bot-controlled seat${botSeats.length === 1 ? "" : "s"} available, so ${want.informed - botSeats.length} informed bot${want.informed - botSeats.length === 1 ? " is" : "s are"} inactive.`;
            continue;
          }
          attachedSeat = botSeats[i - 1];
        }
        const id = `bot-${kind}-${i}`;
        const existing = this.bots.find((b) => b.id === id);
        const name = `${kind[0].toUpperCase()}${kind.slice(1)} bot ${i}${attachedSeat !== null ? ` (reads ${seatName(attachedSeat)})` : ""}`;
        const bot: TradingBot = existing ?? {
          id,
          kind,
          index: i,
          name,
          attachedSeat,
          rng: makeRng(`${this.seed ?? this.code}-${id}`),
          noise: { nextNeedAt: 1, decisions: 0 },
          timer: null,
          lastReason: null,
        };
        bot.attachedSeat = attachedSeat;
        bot.name = name;
        const acct = this.exchange.ensureAccount(id, name, "bot");
        acct.name = name;
        next.push(bot);
      }
    }
    for (const b of this.bots) {
      if (!next.includes(b)) {
        if (b.timer) clearTimeout(b.timer);
        this.exchange.cancelAll(b.id);
      }
    }
    this.bots = next;
    this.setupNote = note;
    if (this.exchange.status === "open") for (const b of this.bots) if (!b.timer) this.scheduleBot(b, true);
  }

  private scheduleBot(b: TradingBot, first = false): void {
    if (b.timer) clearTimeout(b.timer);
    const pace = this.settings.tradingBotPaceMs;
    const delay = first ? 300 + b.rng() * pace : pace * (0.75 + 0.5 * b.rng());
    b.timer = setTimeout(() => {
      b.timer = null;
      if (this.exchange.status !== "open" || !this.bots.includes(b)) return;
      this.runBot(b);
      this.scheduleBot(b);
    }, delay);
  }

  private stopBots(): void {
    for (const b of this.bots) {
      if (b.timer) clearTimeout(b.timer);
      b.timer = null;
    }
  }

  private snapshot(b: TradingBot): BotSnapshot | null {
    const hand = this.hand;
    if (!hand || hand.phase === "ended") return null;
    const pub = publicView(hand);
    const book = {} as Record<ContractId, BotSnapshot["book"][ContractId]>;
    const bookExOwn = {} as Record<ContractId, BotSnapshot["book"][ContractId]>;
    for (const c of CONTRACTS) {
      book[c] = this.exchange.topOfBook(c);
      bookExOwn[c] = this.exchange.topOfBook(c, b.id);
    }
    const acct = this.exchange.accounts.get(b.id)!;
    const snap: BotSnapshot = {
      publicProbs: outcomeProbabilities(pub),
      progress: 1 - Math.min(1, pub.wallCount / 70),
      book,
      bookExOwn,
      positions: { ...acct.positions },
      available: this.exchange.available(b.id),
      openOrderCount: this.exchange.openOrdersOf(b.id).length,
    };
    if (b.kind === "informed") {
      const seat = b.attachedSeat as Seat | null;
      // Privacy guard: only ever read a seat that a table bot is playing right now.
      if (seat === null || this.occupant(seat)?.kind !== "bot") return null;
      snap.privateSeat = { seat, features: privateFeatures(hand.hands[seat], hand.melds[seat].length, pub) };
    }
    return snap;
  }

  /** Decide and execute one round for a bot. Public for tests. */
  runBot(b: TradingBot): BotAction[] {
    const snap = this.snapshot(b);
    if (!snap) return [];
    let actions: BotAction[];
    switch (b.kind) {
      case "informed":
        actions = informedPolicy(snap);
        break;
      case "public":
        actions = publicPolicy(snap);
        break;
      case "noise":
        actions = noisePolicy(snap, b.noise, b.rng);
        break;
      case "random":
        actions = randomPolicy(snap, b.rng);
        break;
    }
    this.decisions[b.kind]++;
    const handId = this.hand!.handId;
    for (const a of actions) {
      if (a.type === "cancelAll") this.exchange.cancelAll(b.id);
      else {
        const r = this.submitOrder(b.id, { t: "order", handId, contract: a.contract, side: a.side, price: a.price, qty: a.qty, tif: a.tif });
        if ("ok" in r && r.result.fills.length) b.lastReason = a.reason;
      }
    }
    this.markDirty();
    return actions;
  }

  botById(id: string): TradingBot | undefined {
    return this.bots.find((b) => b.id === id);
  }

  protected override botViews(): Pick<MarketShared, "bots" | "botSetupNote"> {
    const bots: BotView[] = this.bots.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      description: BOT_DESCRIPTIONS[b.kind],
      attachedSeat: b.attachedSeat,
      settledPnl: this.exchange.accounts.get(b.id)?.settledPnl ?? 0,
    }));
    return { bots, botSetupNote: this.setupNote };
  }

  override dispose(): void {
    this.stopBots();
    super.dispose();
  }
}
