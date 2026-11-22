import type { AccountView, FairPoint, LeaderRow, TradeView } from "../../../shared/market";
import type { ContractId } from "../../../market/types";

export const CONTRACT_COLORS = ["#e3b341", "#6d8cff", "#4fd18b", "#ff79b0", "#a8b3b0"];
export const CONTRACT_IDS: ContractId[] = ["SEAT_0", "SEAT_1", "SEAT_2", "SEAT_3", "DRAW"];
export const shortName = (c: ContractId) => (c === "DRAW" ? "Draw" : `Seat ${"ABCD"[Number(c.slice(5))]}`);
export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

export function AccountBar({ a }: { a: AccountView }) {
  const items: [string, string, string, string?][] = [
    ["Available", a.available.toLocaleString(), "Credits you can commit to new orders right now (cash minus reservations and short collateral)."],
    ["Cash", a.cash.toLocaleString(), "Credits in your account, including proceeds from sales this hand."],
    ["Reserved", a.reserved.toLocaleString(), "Held for your open orders; released when they fill or are cancelled."],
    ["Short collateral", a.shortLock.toLocaleString(), "100 per share you are short — covers the worst case if that contract wins."],
    ["This hand", signed(a.handCashFlow), "Cash in minus cash out from trades this hand, before settlement payouts.", a.handCashFlow >= 0 ? "pos" : "neg"],
    ["Settled P&L", signed(a.settledPnl), `Total profit or loss over all settled hands, versus your ${a.startingCredits.toLocaleString()} starting credits.`, a.settledPnl >= 0 ? "pos" : "neg"],
  ];
  return (
    <dl className="account-bar" data-testid="account-bar">
      {items.map(([k, v, help, cls]) => (
        <div key={k} title={help}>
          <dt>{k}</dt>
          <dd className={cls} data-testid={`acct-${k.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
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
  const W = 320, H = 110, pad = 4;
  const n = Math.max(2, series.length);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (p: number) => H - pad - p * (H - 2 * pad);
  return (
    <figure className="fair-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fair value history per contract">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="grid" />
        ))}
        {CONTRACT_IDS.map((_, k) => (
          <polyline
            key={k}
            fill="none"
            stroke={CONTRACT_COLORS[k]}
            strokeWidth={2}
            points={(series.length === 1 ? [series[0], series[0]] : series).map((pt, i) => `${x(i)},${y(pt.probs[k])}`).join(" ")}
          />
        ))}
      </svg>
      <figcaption className="legend">
        {labels.map((l, k) => (
          <span key={k}>
            <i style={{ background: CONTRACT_COLORS[k] }} />
            {l} {Math.round(100 * series[series.length - 1].probs[k])}
          </span>
        ))}
      </figcaption>
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
              <span className={t.aggressor === "buy" ? "pos" : "neg"}>{t.aggressor === "buy" ? "▲" : "▼"}</span> {t.qty} {shortName(t.contract)} @ <b>{t.price}</b>{" "}
              <span className="muted">
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
