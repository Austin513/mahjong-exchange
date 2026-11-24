import { useEffect, useRef, useState } from "react";
import type { AccountView, FairPoint, LeaderRow, TradeView } from "../../../shared/market";
import type { ContractId } from "../../../market/types";

export const CONTRACT_COLORS = ["#f0b848", "#7c9bff", "#4cd4a0", "#ff7eb6", "#a9b4b1"];
export const CONTRACT_IDS: ContractId[] = ["SEAT_0", "SEAT_1", "SEAT_2", "SEAT_3", "DRAW"];
export const shortName = (c: ContractId) => (c === "DRAW" ? "Draw" : `Seat ${"ABCD"[Number(c.slice(5))]}`);
export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

/** Returns "flash-up" / "flash-down" for a moment after a number changes. */
export function useFlash(v: number | null | undefined): string {
  const prev = useRef(v);
  const [cls, setCls] = useState("");
  useEffect(() => {
    const p = prev.current;
    prev.current = v;
    if (p == null || v == null || p === v) return;
    setCls(v > p ? "flash-up" : "flash-down");
    const t = setTimeout(() => setCls(""), 900);
    return () => clearTimeout(t);
  }, [v]);
  return cls;
}

type Stat = [label: string, value: string, help: string, cls?: string];

export function AccountBar({ a }: { a: AccountView }) {
  const main: Stat[] = [
    ["Available", a.available.toLocaleString(), "Credits you can commit to new orders right now (cash minus reservations and short collateral)."],
    ["This hand", signed(a.handCashFlow), "Cash in minus cash out from trades this hand, before settlement payouts.", a.handCashFlow > 0 ? "pos" : a.handCashFlow < 0 ? "neg" : ""],
    ["Settled P&L", signed(a.settledPnl), `Total profit or loss over all settled hands, versus your ${a.startingCredits.toLocaleString()} starting credits.`, a.settledPnl > 0 ? "pos" : a.settledPnl < 0 ? "neg" : ""],
  ];
  const sub: Stat[] = [
    ["Cash", a.cash.toLocaleString(), "Credits in your account, including proceeds from sales this hand."],
    ["Reserved", a.reserved.toLocaleString(), "Held for your open orders; released when they fill or are cancelled."],
    ["Short collateral", a.shortLock.toLocaleString(), "100 per share you are short. Covers the worst case if that contract wins."],
  ];
  const cell = ([k, v, help, cls]: Stat) => (
    <div key={k} title={help}>
      <dt>{k}</dt>
      <dd className={cls} data-testid={`acct-${k.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
        {v}
      </dd>
    </div>
  );
  return (
    <div className="account" data-testid="account-bar">
      <dl className="account-main">{main.map(cell)}</dl>
      <dl className="account-sub">{sub.map(cell)}</dl>
    </div>
  );
}

export function Positions({ a }: { a: AccountView }) {
  const held = CONTRACT_IDS.filter((c) => a.positions[c] !== 0);
  if (!held.length) return <p className="muted small">No open positions this hand.</p>;
  return (
    <p className="positions small" data-testid="positions">
      Positions:{" "}
      {held.map((c) => (
        <span key={c} className={a.positions[c] > 0 ? "pos" : "neg"}>
          {shortName(c)} {a.positions[c] > 0 ? `long ${a.positions[c]}` : `short ${-a.positions[c]}`}
        </span>
      ))}
    </p>
  );
}

export function FairChart({ series, labels }: { series: FairPoint[]; labels: string[] }) {
  if (series.length < 1) return null;
  const W = 360, H = 150, L = 24, R = 8, T = 8, B = 8;
  const pts = series.length === 1 ? [series[0], series[0]] : series;
  const n = pts.length;
  const top = Math.min(1, Math.max(0.5, ...pts.flatMap((p) => p.probs)) + 0.05);
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (p: number) => T + (1 - p / top) * (H - T - B);
  const grid = [0.25, 0.5, 0.75, 1].filter((g) => g <= top);
  const last = series[series.length - 1];
  return (
    <figure className="fair-chart">
      <figcaption className="chart-title">Fair value over the hand</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fair value history per contract">
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="grid" />
            <text x={L - 5} y={y(g)} className="axis" textAnchor="end" dominantBaseline="central">
              {Math.round(g * 100)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="baseline" />
        {CONTRACT_IDS.map((_, k) => (
          <g key={k}>
            <polyline fill="none" stroke={CONTRACT_COLORS[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map((pt, i) => `${x(i)},${y(pt.probs[k])}`).join(" ")} />
            <circle cx={x(n - 1)} cy={y(last.probs[k])} r={3.2} fill={CONTRACT_COLORS[k]} className="end-dot" />
          </g>
        ))}
      </svg>
      <div className="legend">
        {labels.map((l, k) => (
          <span key={k}>
            <i style={{ background: CONTRACT_COLORS[k] }} />
            {l} <b>{Math.round(100 * last.probs[k])}</b>
          </span>
        ))}
      </div>
    </figure>
  );
}

export function Tape({ tape }: { tape: TradeView[] }) {
  return (
    <div className="tape" data-testid="tape">
      <h4>Recent trades</h4>
      {tape.length === 0 ? (
        <p className="muted small">No trades yet this hand.</p>
      ) : (
        <ul>
          {tape.slice(0, 10).map((t) => (
            <li key={t.id}>
              <span className={`tape-side ${t.aggressor === "buy" ? "pos" : "neg"}`}>{t.aggressor === "buy" ? "▲" : "▼"}</span>
              <span className="tape-what">
                {t.qty} {shortName(t.contract)}
              </span>
              <b className="tape-px">{t.price}</b>
              <span className="tape-who muted">
                {t.buyer} ← {t.seller}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  if (!rows.length) return null;
  return (
    <details className="leaderboard">
      <summary>Leaderboard (settled P&L)</summary>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name + r.kind}>
              <td>
                {r.name} {r.kind === "bot" && <span className="pill pill-bot">trading bot</span>}
              </td>
              <td className={r.settledPnl >= 0 ? "pos" : "neg"}>{signed(r.settledPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
