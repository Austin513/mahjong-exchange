import { useEffect, useRef, useState } from "react";
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
import { Tile } from "../components/Tile";

export const MODE_LABEL = { house: "Trade Against the House", exchange: "Open Exchange" } as const;

export function RoomPage({ code, navigate }: { code: string; navigate: (to: string) => void }) {
  const conn = useRoom(code);
  const { state, status, needName, fatal, toasts, send, join } = conn;
  const [name, setName] = useState(() => storage.get(NAME_KEY) ?? "");
  const [copied, setCopied] = useState(false);
  const phase = state?.room.phase;
  const [tab, setTab] = useState<SideTab>("table");
  // Jump to the market when a hand is dealt, and to the table tab when it's back in the lobby.
  useEffect(() => {
    if (phase === "playing") setTab((t) => (t === "feed" ? t : "market"));
    if (phase === "lobby") setTab("table");
  }, [phase]);
  const feedLen = state?.room.feed.length ?? 0;
  const seen = useRef<number | null>(null);
  if (seen.current === null && state) seen.current = feedLen;
  if (tab === "feed") seen.current = feedLen;
  const unread = Math.max(0, feedLen - (seen.current ?? feedLen));

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
        <span className="header-spacer" />
        {room.seeded && <span className="pill pill-off">seeded test room</span>}
        <span className={`conn conn-${status}`}>{status === "open" ? "Live" : status}</span>
        <span className="room-code" data-testid="room-code">
          Room <b>{room.code}</b>
        </span>
        <button className="btn btn-sm btn-invite" onClick={copy} data-testid="copy-invite">
          {copied ? "Copied!" : "Copy invite"}
        </button>
      </header>

      {status !== "open" && <div className="banner">Connection lost. Reconnecting… your seat and balance are safe.</div>}

      <main className="room-main">
        <div className="table-col">
          {table ? (
            <Board table={table} room={room} perspective={you.seat ?? 0} youSeat={you.seat} />
          ) : (
            <div className="board board-empty">
              <div className="lobby-msg">
                <div className="lobby-tiles" aria-hidden="true">
                  {[31, 27, 22, 13].map((k) => (
                    <Tile key={k} kind={k} size="lg" />
                  ))}
                </div>
                <h2>Waiting for the deal</h2>
                <p>
                  Send friends room code <b>{room.code}</b> or the invite link. Fill all four seats with people or table bots, then the host deals.
                </p>
                {you.isHost ? (
                  <p className="muted">You're the host. Take a seat and add bots in the Table tab.</p>
                ) : (
                  <p className="muted">Grab an empty seat in the Table tab to play, or just watch and trade.</p>
                )}
              </div>
            </div>
          )}
          {table && me && table.phase !== "ended" && <HandPanel me={me} table={table} room={room} act={act} />}
          {table && !me && table.phase !== "ended" && <p className="muted spectate-note">You're spectating, so you only see public information.</p>}
          {table?.phase === "ended" && table.result && (
            <ResultPanel table={table} room={room} isHost={you.isHost} onNext={() => send({ t: "start" })}>
              {market && <SettlementView market={market} />}
            </ResultPanel>
          )}
        </div>
        <aside className="side-col">
          <nav className="side-tabs" role="tablist" aria-label="Sidebar">
            {SIDE_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`side-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
                {t.label}
                {t.id === "feed" && unread > 0 && tab !== "feed" && <span className="tab-count">{unread > 9 ? "9+" : unread}</span>}
              </button>
            ))}
          </nav>
          {tab === "market" &&
            (market ? <MarketPanel market={market} you={you} send={send} /> : <section className="panel muted">The market opens when the first hand is dealt.</section>)}
          {tab === "table" && (
            <>
              {you.isHost && <HostPanel room={room} send={send} botNote={market?.shared.botSetupNote} />}
              <SeatsPanel room={room} you={you} send={send} />
            </>
          )}
          {tab === "feed" && <Feed items={room.feed} />}
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

type SideTab = "market" | "table" | "feed";
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: "market", label: "Market" },
  { id: "table", label: "Table" },
  { id: "feed", label: "Feed" },
];
