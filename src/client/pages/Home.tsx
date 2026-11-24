import { useState } from "react";
import { NAME_KEY, saveToken, storage } from "../net";
import type { GameMode } from "../../shared/protocol";
import { Tile } from "../components/Tile";

const FAN = [31, 13, 14, 15, 27, 22];
const SAMPLE = [
  { seat: "Seat A", px: 31, up: true, color: "#f0b848" },
  { seat: "Seat B", px: 18, up: false, color: "#7c9bff" },
  { seat: "Seat C", px: 27, up: true, color: "#4cd4a0" },
  { seat: "Seat D", px: 16, up: false, color: "#ff7eb6" },
  { seat: "Draw", px: 8, up: false, color: "#a9b4b1" },
];

export function Home({ navigate }: { navigate: (to: string) => void }) {
  const [name, setName] = useState(() => storage.get(NAME_KEY) ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (mode: GameMode) => {
    if (!name.trim()) return setError("Enter a display name first — friends will see it at the table.");
    setBusy(true);
    setError(null);
    try {
      const seed = new URLSearchParams(location.search).get("seed") ?? undefined;
      const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, name: name.trim(), seed }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create the room.");
      storage.set(NAME_KEY, name.trim());
      saveToken(body.code, body.token);
      navigate(`/r/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const joinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(c)}`).catch(() => null);
    if (!res) return setError("Could not reach the server. Check your connection and try again.");
    if (!res.ok) return setError((await res.json()).error);
    if (name.trim()) storage.set(NAME_KEY, name.trim());
    navigate(`/r/${c}`);
  };

  const rules = (e: React.MouseEvent) => (e.preventDefault(), navigate("/rules"));

  return (
    <div className="home">
      <nav className="home-nav">
        <span className="logo-btn">
          <span className="logo-mark">中</span>
          <span className="logo-text">Mahjong Exchange</span>
        </span>
        <a href="/rules" onClick={rules}>
          Rules
        </a>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Riichi mahjong × a live market</p>
          <h1>
            Play the hand.
            <br />
            <em>Trade the outcome.</em>
          </h1>
          <p className="lede">Four seats play a hand of mahjong. Everyone in the room trades on who wins it, and prices move with every discard, call and riichi.</p>
          <div className="home-name">
            <label htmlFor="name">Your name at the table</label>
            <input id="name" className="input" maxLength={24} placeholder="e.g. Austin" value={name} onChange={(e) => setName(e.target.value)} data-testid="home-name" />
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="fan">
            {FAN.map((k, i) => (
              <span key={k} className="fan-tile" style={{ ["--i" as string]: i - (FAN.length - 1) / 2 }}>
                <Tile kind={k} size="lg" />
              </span>
            ))}
          </div>
          <div className="sample-quotes">
            <div className="sample-head">
              <span>Who wins this hand?</span>
              <span className="sample-tag">example</span>
            </div>
            {SAMPLE.map((r) => (
              <div key={r.seat} className="sample-row">
                <i className="dot" style={{ background: r.color }} />
                <span>{r.seat}</span>
                <span className="prob">
                  <span style={{ width: `${r.px}%`, background: r.color }} />
                </span>
                <b className={r.up ? "pos" : "neg"}>
                  {r.px} {r.up ? "▲" : "▼"}
                </b>
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="game-cards" aria-label="Start a room">
        <article className="game-card house">
          <span className="card-kicker">Solo or with friends</span>
          <h2>Trade Against the House</h2>
          <p>The house quotes a bid and an ask on every outcome and re-prices after each move. Your job is to beat its model.</p>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={() => create("house")} data-testid="create-house">
            Create House room
          </button>
        </article>
        <article className="game-card exchange">
          <span className="card-kicker">Best with a group</span>
          <h2>Open Exchange</h2>
          <p>No house. You and your friends post bids and asks into one order book per outcome. Add trading bots if the room is quiet.</p>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={() => create("exchange")} data-testid="create-exchange">
            Create Exchange room
          </button>
        </article>
      </section>

      <form className="join-form" onSubmit={joinByCode}>
        <label htmlFor="code">Got a room code?</label>
        <input id="code" className="input code-input" maxLength={8} placeholder="ABCDE" value={code} onChange={(e) => setCode(e.target.value)} data-testid="join-code" />
        <button className="btn" data-testid="join-code-btn">
          Join room
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <section className="steps" aria-label="How a hand works">
        <h3>How a hand works</h3>
        <ol>
          <li>
            <b>Four seats play.</b> People or table bots play one hand of Riichi mahjong.
          </li>
          <li>
            <b>Five contracts open.</b> One for each seat winning, plus one for a draw.
          </li>
          <li>
            <b>Prices are odds.</b> They run 1 to 99, so 32 means the market thinks 32%.
          </li>
          <li>
            <b>The winner pays 100.</b> Trading stops the moment the hand ends and everything settles.
          </li>
        </ol>
        <a href="/rules" onClick={rules}>
          Read the full rules →
        </a>
      </section>
    </div>
  );
}
