import type { MarketView } from "../../../shared/market";
import { CONTRACT_IDS, shortName, signed } from "./common";

export function SettlementView({ market }: { market: MarketView }) {
  const s = market.shared.lastSettlement;
  const mine = market.mine?.settlement;
  if (!s || s.handId !== market.shared.handId) return null;
  return (
    <div className="settlement" data-testid="settlement">
      <h3>Market settlement</h3>
      <p>
        <b>{shortName(s.winningContract)}</b> paid <b>100</b> per share. Every other contract expired at 0.
      </p>
      <table className="settle-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Payout / share</th>
            <th>Your final position</th>
          </tr>
        </thead>
        <tbody>
          {CONTRACT_IDS.map((c) => (
            <tr key={c} className={c === s.winningContract ? "win-row" : ""}>
              <td>{shortName(c)}</td>
              <td>{c === s.winningContract ? 100 : 0}</td>
              <td>{mine ? mine.positions[c] || "–" : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mine ? (
        <p data-testid="my-settlement">
          Your payout: <b>{signed(mine.payout)}</b> · Hand P&L (payout + trading cash flow): <b className={mine.pnl >= 0 ? "pos" : "neg"}>{signed(mine.pnl)}</b> · Settled P&L total:{" "}
          <b>{signed(market.mine!.account.settledPnl)}</b>
        </p>
      ) : (
        <p className="muted">You had no positions this hand.</p>
      )}
    </div>
  );
}
