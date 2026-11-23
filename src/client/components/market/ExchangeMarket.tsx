import { useState } from "react";
import type { MarketView, OrderView } from "../../../shared/market";
import type { ClientMessage, YouView } from "../../../shared/protocol";
import type { Side, TimeInForce } from "../../../market/types";
import { CONTRACT_COLORS, shortName } from "./common";

interface Props {
  market: MarketView;
  you: YouView;
  send: (m: ClientMessage) => boolean;
}

const STATUS_TEXT: Record<string, string> = {
  user: "cancelled",
  ioc: "IOC remainder cancelled",
  stp: "cancelled (self-trade prevention)",
  settlement: "cancelled at settlement",
};

export function orderStatus(o: OrderView): { text: string; cls: string } {
  if (o.status === "open") return o.filledQty > 0 ? { text: `partially filled ${o.filledQty}/${o.origQty} · resting`, cls: "st-partial" } : { text: "resting", cls: "st-rest" };
  if (o.status === "filled") return { text: `filled ${o.origQty}`, cls: "st-filled" };
  const why = STATUS_TEXT[o.cancelReason ?? "user"] ?? "cancelled";
  return { text: o.filledQty > 0 ? `filled ${o.filledQty}/${o.origQty}, rest ${why}` : why, cls: "st-cancel" };
}

export function ExchangeMarket({ market, you, send }: Props) {
  const { shared, mine } = market;
  const [sel, setSel] = useState(0);
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState(25);
  const [qty, setQty] = useState(10);
  const [tif, setTif] = useState<TimeInForce>("gtc");
  const c = shared.contracts[sel];
  const open = shared.status === "open" && you.canTrade;
  const pos = mine?.account.positions[c.id] ?? 0;
  const committed = (mine?.openOrders ?? []).filter((o) => o.contract === c.id && o.side === "sell").reduce((s, o) => s + o.qty, 0);
  const covered = side === "sell" ? Math.min(qty, Math.max(0, pos - committed)) : 0;
  const reserve = side === "buy" ? qty * price : (qty - covered) * (100 - price);
  const myAt = (p: number, s: Side) => (mine?.openOrders ?? []).filter((o) => o.contract === c.id && o.side === s && o.price === p).reduce((a, o) => a + o.qty, 0);
  const clampPx = (p: number) => Math.max(1, Math.min(99, Math.round(p) || 1));

  const submit = () => shared.handId && send({ t: "order", handId: shared.handId, contract: c.id, side, price, qty, tif });

  return (
    <div className="exchange-market">
      <div className="contract-tabs" role="tablist">
        {shared.contracts.map((x, k) => {
          const bb = x.bids[0]?.price, ba = x.asks[0]?.price;
          return (
            <button key={x.id} role="tab" aria-selected={k === sel} className={`ctab ${k === sel ? "on" : ""}`} onClick={() => setSel(k)} data-testid={`ctab-${x.id}`}>
              <i className="dot" style={{ background: CONTRACT_COLORS[k] }} />
              {shortName(x.id)}
              <span className="ctab-px">
                {bb ?? "–"} / {ba ?? "–"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ex-grid">
        <div className="ladder" data-testid="ladder">
          <div className="ladder-title">
            {c.label} {c.last !== null && <span className="muted small">last {c.last}</span>}
          </div>
          {c.bids.length === 0 && c.asks.length === 0 ? (
            <p className="muted small empty-book" data-testid="empty-book">
              Empty book — no one has quoted this contract yet. Post the first bid or ask.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Bid qty</th>
                  <th>Price</th>
                  <th>Ask qty</th>
                </tr>
              </thead>
              <tbody>
                {[...c.asks].reverse().map((l) => (
                  <tr key={`a${l.price}`} className="ask-row" onClick={() => (setPrice(l.price), setSide("buy"))}>
                    <td />
                    <td className="ask">{l.price}</td>
                    <td>
                      {l.qty}
                      {myAt(l.price, "sell") > 0 && <span className="mine"> (you {myAt(l.price, "sell")})</span>}
                    </td>
                  </tr>
                ))}
                {c.bids.map((l) => (
                  <tr key={`b${l.price}`} className="bid-row" onClick={() => (setPrice(l.price), setSide("sell"))}>
                    <td>
                      {myAt(l.price, "buy") > 0 && <span className="mine">(you {myAt(l.price, "buy")}) </span>}
                      {l.qty}
                    </td>
                    <td className="bid">{l.price}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <form
          className="ticket"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          data-testid="order-ticket"
        >
          <div className="seg">
            <button type="button" className={`btn btn-sm ${side === "buy" ? "btn-buy on" : ""}`} onClick={() => setSide("buy")} data-testid="side-buy">
              Buy
            </button>
            <button type="button" className={`btn btn-sm ${side === "sell" ? "btn-sell on" : ""}`} onClick={() => setSide("sell")} data-testid="side-sell">
              Sell
            </button>
          </div>
          <label>
            Price
            <span className="stepper">
              <button type="button" className="btn btn-sm" onClick={() => setPrice(clampPx(price - 1))} aria-label="Lower price">
                −
              </button>
              <input type="number" min={1} max={99} value={price} onChange={(e) => setPrice(clampPx(Number(e.target.value)))} data-testid="ticket-price" />
              <button type="button" className="btn btn-sm" onClick={() => setPrice(clampPx(price + 1))} aria-label="Raise price">
                +
              </button>
            </span>
          </label>
          <label>
            Shares
            <input type="number" min={1} max={1000} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(1000, Math.round(Number(e.target.value)) || 1)))} data-testid="ticket-qty" />
          </label>
          <label>
            Type
            <select value={tif} onChange={(e) => setTif(e.target.value as TimeInForce)} data-testid="ticket-tif">
              <option value="gtc">Limit · rests until filled/cancelled</option>
              <option value="ioc">Immediate-or-cancel</option>
            </select>
          </label>
          <p className="small muted" data-testid="ticket-preview">
            {side === "buy" ? `Buy ${qty} ${shortName(c.id)} at ${price} or better` : `Sell ${qty} ${shortName(c.id)} at ${price} or better`}. Reserves <b>{reserve.toLocaleString()}</b> credits
            {side === "sell" && covered > 0 ? ` (${covered} covered by your long)` : ""}.
          </p>
          <button className={`btn btn-block ${side === "buy" ? "btn-buy" : "btn-sell"}`} disabled={!open} data-testid="ticket-submit">
            {side === "buy" ? "Place bid" : "Place ask"} · {qty} @ {price}
          </button>
        </form>
      </div>
      <MyOrders market={market} send={send} />
    </div>
  );
}

function MyOrders({ market, send }: { market: MarketView; send: (m: ClientMessage) => boolean }) {
  const mine = market.mine;
  if (!mine) return null;
  return (
    <div className="my-orders" data-testid="my-orders">
      <h4>
        Your orders
        {mine.openOrders.length > 1 && (
          <button className="btn btn-sm btn-ghost" onClick={() => send({ t: "cancelAll" })}>
            Cancel all
          </button>
        )}
      </h4>
      {mine.openOrders.length === 0 && mine.recentOrders.length === 0 && <p className="muted small">No orders yet.</p>}
      <ul>
        {mine.openOrders.map((o) => {
          const st = orderStatus(o);
          return (
            <li key={o.id} data-testid={`order-${o.id}`}>
              <span className={o.side === "buy" ? "pos" : "neg"}>{o.side}</span> {o.qty} {shortName(o.contract)} @ {o.price} <span className={`st ${st.cls}`}>{st.text}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => send({ t: "cancel", orderId: o.id })} data-testid={`cancel-${o.id}`}>
                Cancel
              </button>
            </li>
          );
        })}
        {mine.recentOrders.slice(0, 5).map((o) => {
          const st = orderStatus(o);
          return (
            <li key={`r${o.id}`} className="closed">
              <span className={o.side === "buy" ? "pos" : "neg"}>{o.side}</span> {o.origQty} {shortName(o.contract)} @ {o.price} <span className={`st ${st.cls}`}>{st.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
