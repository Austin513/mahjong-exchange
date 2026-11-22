import { useState } from "react";
import { NAME_KEY, saveToken, storage } from "../net";
import type { GameMode } from "../../shared/protocol";

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

  return (
    <div className="home">
      <header className="home-hero">
        <div className="logo-mark big">中</div>
        <h1>Mahjong Exchange</h1>
        <p className="lede">A live four-seat Riichi table with a play-money market on who wins each hand. Watch, play, and trade with friends.</p>
      </header>

      <div className="home-name">
        <label htmlFor="name">Your display name</label>
        <input id="name" className="input" maxLength={24} placeholder="e.g. Austin" value={name} onChange={(e) => setName(e.target.value)} data-testid="home-name" />
      </div>

      <div className="game-cards">
        <article className="game-card house">
          <h2>Trade Against the House</h2>
          <p>The house quotes a bid and ask on every outcome — each seat winning, or a draw — and re-prices from public information after every discard, call, and riichi.</p>
          <ul>
            <li>Buy at the house ask or sell to its bid</li>
            <li>See fair value and why it moved</li>
            <li>Great for solo play with bot-filled seats</li>
          </ul>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => create("house")} data-testid="create-house">
            Create House room
          </button>
        </article>
        <article className="game-card exchange">
          <h2>Open Exchange</h2>
          <p>No house. Everyone posts their own bids and asks into one shared order book per contract. Friends — and any trading bots you enable — are the counterparties.</p>
          <ul>
            <li>Price-time priority matching</li>
            <li>Make markets from a fresh account</li>
            <li>Optional informed, public, noise, and random trading bots</li>
          </ul>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => create("exchange")} data-testid="create-exchange">
            Create Exchange room
          </button>
        </article>
      </div>

      <form className="join-form" onSubmit={joinByCode}>
        <label htmlFor="code">Have a code?</label>
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

      <section className="explainer">
        <h3>How a hand works</h3>
        <ol>
          <li>Four seats play one hand of Riichi mahjong (humans or smart table bots).</li>
          <li>Each hand lists five contracts: one per seat plus DRAW. The winner's contract pays 100 credits per share; the rest pay 0.</li>
          <li>Prices are in credits (1–99), so a price reads as a probability in percent.</li>
          <li>Trading closes the instant the hand ends. Settlement is automatic.</li>
        </ol>
        <a href="/rules" onClick={(e) => (e.preventDefault(), navigate("/rules"))}>
          Read the rules →
        </a>
      </section>
    </div>
  );
}
