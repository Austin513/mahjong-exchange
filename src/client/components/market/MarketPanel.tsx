import type { MarketView } from "../../../shared/market";
import type { ClientMessage, YouView } from "../../../shared/protocol";
import { AccountBar, Leaderboard, Positions, Tape } from "./common";
import { HouseMarket } from "./HouseMarket";
import { ExchangeMarket } from "./ExchangeMarket";

export function MarketPanel({ market, you, send }: { market: MarketView; you: YouView; send: (m: ClientMessage) => boolean }) {
  const { shared, mine } = market;
  return (
    <section className="panel market" aria-label="Market" data-testid="market-panel">
      <header className="market-head">
        <h3>{shared.mode === "house" ? "House market" : "Open Exchange"}</h3>
        <span className={`mstatus ms-${shared.status}`} data-testid="market-status">
          {shared.status === "open" ? "OPEN" : shared.status === "closed" ? "CLOSED · settled" : "opens at the deal"}
        </span>
      </header>
      <p className="muted small">
        {shared.mode === "house"
          ? "The house is your counterparty. Each contract pays 100 credits per share if it wins and 0 otherwise."
          : "Everyone trades in one shared book per contract. No house liquidity — friends and enabled trading bots are the counterparties."}
      </p>
      {mine && <AccountBar a={mine.account} />}
      {mine && <Positions a={mine.account} />}
      {!you.canTrade && you.tradeBlockedReason && (
        <p className="blocked small" data-testid="trade-blocked">
          {you.tradeBlockedReason}
        </p>
      )}
      {shared.mode === "house" ? <HouseMarket market={market} you={you} send={send} /> : <ExchangeMarket market={market} you={you} send={send} />}
      <Tape tape={shared.tape} />
      <Leaderboard rows={shared.leaderboard} />
    </section>
  );
}
