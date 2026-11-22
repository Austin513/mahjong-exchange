import { useState } from "react";
import { useRoom, NAME_KEY, storage } from "../net";
import { Board } from "../components/Board";
import { HandPanel } from "../components/HandPanel";
import { SeatsPanel } from "../components/SeatsPanel";
import { HostPanel } from "../components/HostPanel";
import { Feed } from "../components/Feed";
import { ResultPanel } from "../components/ResultPanel";
import type { Action } from "../../engine/types";
import { MarketPanel } from "../components/market/MarketPanel";
import { SettlementView } from "../components/market/SettlementView";

export const MODE_LABEL = { house: "Trade Against the House", exchange: "Open Exchange" } as const;

export function RoomPage({ code, navigate }: { code: string; navigate: (to: string) => void }) {
  const conn = useRoom(code);
  const { state, status, needName, fatal, toasts, send, join } = conn;
  const [name, setName] = useState(() => storage.get(NAME_KEY) ?? "");
  const [copied, setCopied] = useState(false);

  if (fatal) {
    return (
      <div className="page-center">
        <div className="card">
          <h2>Room not found</h2>
          <p>{fatal}</p>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Back to the lobby
          </button>
        </div>
      </div>
    );
  }

  if (needName) {
    return (
      <div className="page-center">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) join(name.trim());
          }}
        >
          <h2>Join room {code.toUpperCase()}</h2>
          <p className="muted">Pick a display name. You'll join as a spectator — you can trade right away and claim an open seat between hands.</p>
          <input className="input" autoFocus maxLength={24} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} data-testid="join-name" />
          <button className="btn btn-primary btn-block" disabled={!name.trim()} data-testid="join-submit">
            Join
          </button>
        </form>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="page-center">
        <p className="muted">{status === "reconnecting" ? "Reconnecting…" : "Connecting to room…"}</p>
      </div>
    );
  }

  const { room, table, me, you, market } = state;
  const act = (action: Action) => table && send({ t: "act", handId: table.handId, action });
  const invite = `${location.origin}/r/${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy this invite link", invite);
    }
  };

  return (
    <div className="room">
      <header className="room-header">
        <button className="logo-btn" onClick={() => navigate("/")} aria-label="Home">
          <span className="logo-mark">中</span>
          <span className="logo-text">Mahjong Exchange</span>
        </button>
        <span className={`mode-badge mode-${room.mode}`} data-testid="mode-badge">
          {MODE_LABEL[room.mode]}
        </span>
        <span className="room-code" data-testid="room-code">
          Room <b>{room.code}</b>
        </span>
        <button className="btn btn-sm" onClick={copy} data-testid="copy-invite">
          {copied ? "Copied!" : "Copy invite"}
        </button>
        {room.seeded && <span className="pill pill-off">seeded test room</span>}
        <span className={`conn conn-${status}`}>{status === "open" ? "live" : status}</span>
      </header>

      {status !== "open" && <div className="banner">Connection lost — reconnecting. Your seat and balance are safe.</div>}

      <main className="room-main">
        <div className="table-col">
          {table ? (
            <Board table={table} room={room} perspective={you.seat ?? 0} youSeat={you.seat} />
          ) : (
            <div className="board board-empty">
              <div className="lobby-msg">
                <h2>{MODE_LABEL[room.mode]}</h2>
                <p>
                  Share code <b>{room.code}</b> or the invite link. Fill four seats with friends or smart table bots, then the host deals.
                </p>
                {you.isHost ? <p>You're the host: use the seat list to sit and add bots.</p> : <p>Waiting for the host to deal. Claim an empty seat to play, or just watch.</p>}
              </div>
            </div>
          )}
          {table && me && table.phase !== "ended" && <HandPanel me={me} table={table} room={room} act={act} />}
          {table && !me && table.phase !== "ended" && <p className="muted spectate-note">You are spectating — you see only public information.</p>}
          {table?.phase === "ended" && table.result && (
            <ResultPanel table={table} room={room} isHost={you.isHost} onNext={() => send({ t: "start" })}>
              {market && <SettlementView market={market} />}
            </ResultPanel>
          )}
        </div>
        <aside className="side-col">
          {market && <MarketPanel market={market} you={you} send={send} />}
          {you.isHost && <HostPanel room={room} send={send} />}
          <SeatsPanel room={room} you={you} send={send} />
          <Feed items={room.feed} />
        </aside>
      </main>

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} data-testid={`toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
