import type { ReactNode } from "react";
import { TRADING_BOT_KINDS, type ClientMessage, type RoomSettings, type RoomView } from "../../shared/protocol";

interface Props {
  room: RoomView;
  send: (m: ClientMessage) => void;
  botNote?: string | null;
  children?: ReactNode;
}

const BOT_LABELS = {
  informed: { name: "Informed", help: "reads one table-bot seat's hidden hand (never a human's)" },
  public: { name: "Public", help: "public information only; quotes around fair value" },
  noise: { name: "Noise", help: "liquidity needs unrelated to the hand" },
  random: { name: "Random", help: "seeded random baseline" },
} as const;

export function HostPanel({ room, send, botNote, children }: Props) {
  const s = room.settings;
  const set = (patch: Partial<RoomSettings>) => send({ t: "settings", settings: patch });
  const canStart = room.phase !== "playing" && room.seats.every(Boolean);
  return (
    <section className="panel host-panel" aria-label="Host controls" data-testid="host-panel">
      <h3>Host controls</h3>
      {room.phase === "lobby" && (
        <button className="btn btn-primary btn-block" disabled={!canStart} onClick={() => send({ t: "start" })} data-testid="btn-start">
          {canStart ? "Deal the first hand" : "Fill all 4 seats to start"}
        </button>
      )}
      <label className="field-row">
        <span>
          Seated players may trade
          <span className="muted small"> — using their own tile knowledge</span>
        </span>
        <input type="checkbox" checked={s.seatedCanTrade} onChange={(e) => set({ seatedCanTrade: e.target.checked })} data-testid="toggle-seated-trade" />
      </label>
      <details>
        <summary>Table timing</summary>
        <label className="field-row">
          Table bot speed
          <select value={s.botDelayMs} onChange={(e) => set({ botDelayMs: Number(e.target.value) })}>
            <option value={250}>Fast</option>
            <option value={700}>Normal</option>
            <option value={1500}>Slow</option>
          </select>
        </label>
        <label className="field-row">
          Human turn timer
          <select value={s.turnSeconds} onChange={(e) => set({ turnSeconds: Number(e.target.value) })}>
            {[20, 40, 90].map((v) => (
              <option key={v} value={v}>
                {v}s
              </option>
            ))}
          </select>
        </label>
        <label className="field-row">
          Claim timer
          <select value={s.claimSeconds} onChange={(e) => set({ claimSeconds: Number(e.target.value) })}>
            {[6, 12, 20].map((v) => (
              <option key={v} value={v}>
                {v}s
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">When a timer runs out, autopilot makes that one move. Disconnected players are covered by autopilot until they return.</p>
      </details>
      {room.mode === "exchange" ? (
        <details open data-testid="trading-bot-settings">
          <summary>Trading bots (Open Exchange only)</summary>
          <p className="muted small">
            Trading bots trade contracts — they do <b>not</b> play tiles. Table bots (seat list) play mahjong. Every trading bot uses the same order and collateral rules as you.
          </p>
          {TRADING_BOT_KINDS.map((k) => (
            <label key={k} className="field-row bot-row">
              <span>
                <b>{BOT_LABELS[k].name}</b>
                <span className="muted small"> — {BOT_LABELS[k].help}</span>
              </span>
              <select value={s.tradingBots[k]} onChange={(e) => set({ tradingBots: { ...s.tradingBots, [k]: Number(e.target.value) } })} data-testid={`bots-${k}`}>
                {[0, 1, 2, 3, 4].filter((n) => k !== "informed" || n <= 4).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field-row">
            Bot pace
            <select value={s.tradingBotPaceMs} onChange={(e) => set({ tradingBotPaceMs: Number(e.target.value) })} data-testid="bot-pace">
              <option value={1000}>Fast (≈1 s)</option>
              <option value={2500}>Normal (≈2.5 s)</option>
              <option value={6000}>Slow (≈6 s)</option>
            </select>
          </label>
          {botNote && <p className="blocked small" data-testid="bot-setup-note">{botNote}</p>}
        </details>
      ) : (
        <p className="muted small">House mode: the house provides all liquidity, so trading bots are off.</p>
      )}
      {children}
    </section>
  );
}
