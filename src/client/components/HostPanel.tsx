import type { ReactNode } from "react";
import type { ClientMessage, RoomSettings, RoomView } from "../../shared/protocol";

interface Props {
  room: RoomView;
  send: (m: ClientMessage) => void;
  children?: ReactNode;
}

export function HostPanel({ room, send, children }: Props) {
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
      {children}
    </section>
  );
}
