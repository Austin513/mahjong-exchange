import type { ClientMessage, RoomView, YouView } from "../../shared/protocol";
import { seatName } from "../../shared/protocol";

interface Props {
  room: RoomView;
  you: YouView;
  send: (m: ClientMessage) => void;
}

export function SeatsPanel({ room, you, send }: Props) {
  const between = room.phase !== "playing";
  return (
    <section className="panel" aria-label="Seats" data-testid="seats-panel">
      <h3>
        Table seats <span className="muted small">· mahjong players</span>
      </h3>
      <p className="muted small">
        Exactly four seats. Seats can change only between hands. <b>Table bots</b> play mahjong tiles — they are different from trading bots.
      </p>
      <ul className="seat-list">
        {room.seats.map((o, i) => {
          const mine = you.seat === i;
          return (
            <li key={i} className="seat-row" data-testid={`seat-row-${i}`}>
              <span className="seat-row-name">{seatName(i)}</span>
              <span className="seat-row-occ">
                {!o && <span className="muted">empty</span>}
                {o?.kind === "human" && (
                  <>
                    {o.name}
                    {mine && " (you)"} <span className={`pill ${o.connected ? "pill-on" : "pill-off"}`}>{o.away ? "away · autopilot" : o.connected ? "human" : "offline"}</span>
                  </>
                )}
                {o?.kind === "bot" && (
                  <>
                    {o.name} <span className="pill pill-bot">{o.bot === "smart" ? "smart table bot" : "random table bot"}</span>
                  </>
                )}
              </span>
              <span className="seat-row-actions">
                {between && you.seat === null && (!o || o.kind === "bot") && (
                  <button className="btn btn-sm" onClick={() => send({ t: "sit", seat: i })} data-testid={`sit-${i}`}>
                    Sit here
                  </button>
                )}
                {between && mine && (
                  <button className="btn btn-sm btn-ghost" onClick={() => send({ t: "stand" })}>
                    Stand up
                  </button>
                )}
                {between && you.isHost && !o && (
                  <>
                    <button className="btn btn-sm" onClick={() => send({ t: "addBot", seat: i, bot: "smart" })} data-testid={`add-smart-${i}`}>
                      + Smart bot
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => send({ t: "addBot", seat: i, bot: "random" })}>
                      + Random bot
                    </button>
                  </>
                )}
                {between && you.isHost && o?.kind === "bot" && (
                  <button className="btn btn-sm btn-ghost" onClick={() => send({ t: "removeBot", seat: i })}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {you.isHost && between && room.seats.some((s) => !s) && (
        <button
          className="btn btn-sm"
          onClick={() => room.seats.forEach((s, i) => !s && send({ t: "addBot", seat: i, bot: "smart" }))}
          data-testid="fill-bots"
        >
          Fill empty seats with smart table bots
        </button>
      )}
      <p className="muted small">
        {room.spectatorCount} spectator{room.spectatorCount === 1 ? "" : "s"} watching
        {you.seat === null && " — you are spectating"}
      </p>
    </section>
  );
}
