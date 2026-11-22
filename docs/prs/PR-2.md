# PR 2 — Ledger, matching engine, House mode, and Open Exchange

**Branch:** `pr2-market` → stacked on `pr1-table` · **Depends on:** PR 1

## Summary
- `src/market/exchange.ts`: an integer-tick ledger plus a price-time-priority matching engine.
  - It is fully collateralised: buys reserve `qty × limit`, covered sells reserve shares, and short sells reserve `(100 − limit)`. A filled short locks 100 per share.
  - Fills book at the resting price and release the reservation at each order's own limit.
  - Self-trade prevention cancels the resting order (expire-maker) and keeps matching.
  - `settle(handId)` is idempotent and cancels every order first.
- `src/server/marketRoom.ts`: the market lives inside the room's serialized command path.
  - Settlement runs in `onHandEnded`, in the same call stack as the winning action or the exhaustive draw. No order can land after the outcome is final.
  - Seated trading follows the host toggle, and humans and bots share one order path (`submitOrder`).
- House mode.
  - The house's quotes are real resting orders. A player's click is an IOC limit at the price they saw: they get that price or better, or nothing plus an error naming the refreshed quote. GTC is rejected in this mode.
  - Repricing is deferred with `setImmediate` and stamped with the table version. A stale result is dropped and the opening quotes are synchronous.
  - Each move gets a fair-value series point and a written explanation that names the event and the biggest movers.
- `src/pricing`: a conditional multinomial logit over public features (seat-symmetric β, draw γ), fitted on self-play by `npm run fit-model`. The informed seat model is fitted and checked in here; it is used in PR 3. The quoter applies fair ± half-spread, an inventory skew, and inventory limits.
- UI.
  - An account bar with labelled, explained numbers.
  - House quote board with the cost on each button, a fair-value chart, the "why prices moved" line, and house inventory.
  - Exchange contract tabs, a depth ladder marking your own size, an order ticket with a reservation preview, order status chips (resting, partial, filled, cancelled, STP), the tape and a leaderboard.
  - A settlement view showing payout per contract, final positions and P&L.

## Model validation (held-out, simulation; docs/MODEL.md)
| model | log loss | Brier |
|---|---|---|
| base rate | 1.6452 | 0.8094 |
| time + dealer only | 1.5744 | 0.7827 |
| full public model | 1.4445 | 0.7301 |

Calibration is good through the 0.45 bin. The model is overconfident above 0.6: predicted 0.66, observed 0.53, n=2147.
Informed seat model, held-out per-seat log loss: 0.4634 for the public model only and 0.4556 with the private hand.

## Acceptance criteria
- [x] Buy 10 @ 32: a win gives +680 / −680, expiry gives −320 / +320, and the draw contract pays on an exhaustive draw.
- [x] After a partial fill and a cancelled remainder, both users' available credit is exact (`tests/market.test.ts`).
- [x] Price-time priority, resting-price fills, IOC, self-trade prevention, insufficient collateral, and covered vs naked sells.
- [x] Settlement is exactly-once and atomic with the hand end. No order is accepted after the outcome (instrumented test).
- [x] A stale house quote is rejected with the refreshed price, and a better price fills.
- [x] A human-to-human fill with no house account and no bots, over real WebSockets.
- [x] A random-flow fuzz conserves cash and shares, and available credit never goes negative.

## Verification
```
npm run typecheck && npm run lint   # clean
npm test                            # 76 passed (+ market 17, marketRoom 7, pricing 9, ws 3)
npm run fit-model -- 1500 500       # 460 s, writes coefficients.json + docs/MODEL.md
npm run build                       # ok
```
Browser (headless Chromium): I played a House hand with fast table bots and bought and sold through the UI. Settlement showed
payout +500 and P&L +405, which is consistent with the three fills. An Exchange room showed resting bid and ask orders with 940 reserved.

## Limitations
- The model is trained on smart-bot self-play only, so human tables may differ. It uses no tile-level danger reads.
- The house bankroll is effectively unlimited (1e9), and its risk is managed by the skew and an inventory cap of 400 per contract.
- Market state is in memory, like rooms.
