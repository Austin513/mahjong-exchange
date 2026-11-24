import { useState } from "react";
import type { ContractView, MarketView } from "../../../shared/market";
import type { ClientMessage, YouView } from "../../../shared/protocol";
import type { ContractId, Side } from "../../../market/types";
import { CONTRACT_COLORS, FairChart, shortName, useFlash } from "./common";

interface Props {
  market: MarketView;
  you: YouView;
  send: (m: ClientMessage) => boolean;
}

const QTYS = [1, 5, 10, 25];

export function HouseMarket({ market, you, send }: Props) {
  const [qty, setQty] = useState(5);
  const { shared, mine } = market;
  const open = shared.status === "open" && you.canTrade;
  const trade = (contract: ContractId, side: Side, price: number) =>
    shared.handId && send({ t: "order", handId: shared.handId, contract, side, price, qty, tif: "ioc" });

  return (
    <div className="house-market">
      <div className="qty-row">
        <span className="muted small">Shares per click</span>
        <div className="seg-group" role="group" aria-label="Shares per click">
          {QTYS.map((q) => (
            <button key={q} className={`seg-btn ${q === qty ? "on" : ""}`} onClick={() => setQty(q)} aria-pressed={q === qty} data-testid={`qty-${q}`}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <table className="quotes" data-testid="house-quotes">
        <thead>
          <tr>
            <th>Contract</th>
            <th title="The house's model estimate of the probability, in credits">Fair</th>
            <th>Sell to bid</th>
            <th>Buy at ask</th>
            <th>You</th>
          </tr>
        </thead>
        <tbody>
          {shared.contracts.map((c, k) => (
            <QuoteRow key={c.id} c={c} k={k} qty={qty} pos={mine?.account.positions[c.id] ?? 0} open={open} trade={trade} />
          ))}
        </tbody>
      </table>
      <p className="muted small">
        You get the price on the button or better. If the house re-prices against you first, nothing trades and you see the new quote.
      </p>
      {shared.explanation && (
        <p className="why" data-testid="price-explanation">
          <span className="why-label">Why prices moved</span> {shared.explanation}
        </p>
      )}
      <FairChart series={shared.fairSeries} labels={shared.contracts.map((c) => shortName(c.id))} />
      {shared.house && (
        <p className="muted small" data-testid="house-inventory">
          House inventory:{" "}
          {shared.contracts.map((c) => `${shortName(c.id)} ${shared.house!.inventory[c.id] > 0 ? "+" : ""}${shared.house!.inventory[c.id]}`).join(" · ")}. Quotes = fair ± {shared.house.halfSpread}, shifted{" "}
          {shared.house.skewPerShare} per share of inventory so the house leans against its exposure.
        </p>
      )}
    </div>
  );
}

interface RowProps {
  c: ContractView;
  k: number;
  qty: number;
  pos: number;
  open: boolean;
  trade: (contract: ContractId, side: Side, price: number) => unknown;
}

function QuoteRow({ c, k, qty, pos, open, trade }: RowProps) {
  const h = c.house;
  const fairFlash = useFlash(h?.fair);
  const bidFlash = useFlash(h?.bid);
  const askFlash = useFlash(h?.ask);
  const shortCost = h?.bid != null ? Math.max(0, qty - Math.max(0, pos)) * (100 - h.bid) : 0;
  const who = c.label.includes("·") ? c.label.split("· ")[1] : null;
  return (
    <tr data-testid={`quote-${c.id}`}>
      <th scope="row">
        <span className="contract-name">
          <i className="dot" style={{ background: CONTRACT_COLORS[k] }} />
          {shortName(c.id)}
        </span>
        {who && <span className="who">{who}</span>}
        <span className="prob" aria-hidden="true">
          <span style={{ width: `${Math.min(100, h?.fair ?? 0)}%`, background: CONTRACT_COLORS[k] }} />
        </span>
      </th>
      <td className={`fair ${fairFlash}`}>{h ? h.fair.toFixed(1) : "–"}</td>
      <td>
        {h?.bid != null ? (
          <button
            className={`quote-btn quote-sell ${bidFlash}`}
            disabled={!open}
            onClick={() => trade(c.id, "sell", h.bid!)}
            title={shortCost > 0 ? `Opens a short: reserves ${shortCost} credits of collateral` : "Sells shares you hold"}
            data-testid={`sell-${c.id}`}
          >
            <b>{h.bid}</b> <span className="quote-size">×{h.bidSize}</span>
            <span className="quote-cost">
              Sell {qty} → +{qty * h.bid}
            </span>
          </button>
        ) : (
          <span className="muted small">no bid</span>
        )}
      </td>
      <td>
        {h?.ask != null ? (
          <button className={`quote-btn quote-buy ${askFlash}`} disabled={!open} onClick={() => trade(c.id, "buy", h.ask!)} data-testid={`buy-${c.id}`}>
            <b>{h.ask}</b> <span className="quote-size">×{h.askSize}</span>
            <span className="quote-cost">
              Buy {qty} → −{qty * h.ask}
            </span>
          </button>
        ) : (
          <span className="muted small">no ask</span>
        )}
      </td>
      <td className={`pos-cell ${pos > 0 ? "pos" : pos < 0 ? "neg" : "muted"}`} data-testid={`pos-${c.id}`}>
        {pos === 0 ? "–" : pos > 0 ? `+${pos}` : pos}
      </td>
    </tr>
  );
}
