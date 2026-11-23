import { useState } from "react";
import type { MarketView } from "../../../shared/market";
import type { ClientMessage, YouView } from "../../../shared/protocol";
import type { ContractId, Side } from "../../../market/types";
import { CONTRACT_COLORS, FairChart, shortName } from "./common";

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
        {QTYS.map((q) => (
          <button key={q} className={`btn btn-sm ${q === qty ? "btn-primary" : ""}`} onClick={() => setQty(q)} aria-pressed={q === qty} data-testid={`qty-${q}`}>
            {q}
          </button>
        ))}
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
          {shared.contracts.map((c, k) => {
            const h = c.house;
            const pos = mine?.account.positions[c.id] ?? 0;
            const shortCost = h?.bid != null ? Math.max(0, qty - Math.max(0, pos)) * (100 - h.bid) : 0;
            return (
              <tr key={c.id} data-testid={`quote-${c.id}`}>
                <th scope="row">
                  <i className="dot" style={{ background: CONTRACT_COLORS[k] }} />
                  {shortName(c.id)}
                  {c.label.includes("·") && <span className="who">{c.label.split("· ")[1]}</span>}
                </th>
                <td className="fair">{h ? h.fair.toFixed(1) : "–"}</td>
                <td>
                  {h?.bid != null ? (
                    <button
                      className="btn btn-sell quote-btn"
                      disabled={!open}
                      onClick={() => trade(c.id, "sell", h.bid!)}
                      title={shortCost > 0 ? `Opens a short: reserves ${shortCost} credits of collateral` : "Sells shares you hold"}
                      data-testid={`sell-${c.id}`}
                    >
                      <b>{h.bid}</b> <span className="small">×{h.bidSize}</span>
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
                    <button className="btn btn-buy quote-btn" disabled={!open} onClick={() => trade(c.id, "buy", h.ask!)} data-testid={`buy-${c.id}`}>
                      <b>{h.ask}</b> <span className="small">×{h.askSize}</span>
                      <span className="quote-cost">
                        Buy {qty} → −{qty * h.ask}
                      </span>
                    </button>
                  ) : (
                    <span className="muted small">no ask</span>
                  )}
                </td>
                <td className={pos > 0 ? "pos" : pos < 0 ? "neg" : "muted"} data-testid={`pos-${c.id}`}>
                  {pos === 0 ? "–" : pos > 0 ? `+${pos}` : pos}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        A click is a limit at the price shown: you get that price or better. If the house re-priced against you first, nothing trades and you'll see the new quote.
      </p>
      {shared.explanation && (
        <p className="why" data-testid="price-explanation">
          <b>Why prices moved:</b> {shared.explanation}
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
