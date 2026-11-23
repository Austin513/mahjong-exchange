# PR 3 — Trading bots, end-to-end tests, load test, polish, and the QT experiment

**Branch:** `pr3-bots-e2e` → stacked on `pr2-market` · **Depends on:** PR 2

## Summary
- **Trading bots** (`src/bots/trading/policies.ts`, `src/server/tradingRoom.ts`). These run in Open Exchange only;
  House liquidity stays with the house. Each kind uses different inputs:
  - **Informed:** attached to a bot-controlled seat. It reads only that seat's hand (shanten and live outs) through the
    fitted informed model and trades when its edge beats the price by 3 or more ticks.
  - **Public:** uses the public model, quotes ±4 around it, and takes at 6+ ticks of edge.
  - **Noise:** trades on scheduled liquidity needs and reduces inventory, ignoring the hand.
  - **Random:** a seeded baseline with bounded actions.
  - Every bot has its own name and ledger account, uses `submitOrder` (the same execution and collateral path as
    humans), and acts at a host-set pace.
  - A setup note explains when informed bots can't attach. They never read a human's tiles, including a human on
    autopilot.
- Host UI: trading-bot counts and pace, labelled "they trade contracts, they do not play tiles". The market panel lists
  the room's bots and the leaderboard tags them. Bot-count changes now send partial updates, which fixes a race that
  e2e found when several counts were changed quickly.
- **Playwright e2e** (`e2e/game.spec.ts`), using independent browser contexts against the production server:
  - House mode: the host fills bots and deals; a 390×844 phone joins by invite URL mid-hand; both trade and see the same
    tape; both see settlement; then the next hand starts.
  - Open Exchange with **no trading bots**: a bid rests, a phone user sells into it (partial fill), the remainder is
    cancelled and available credit is exact, a reload keeps the identity and position, and settlement shows on both.
  - A seated human plays a whole hand with 3 smart bots through the UI.
  - Trading bots appear with their identities and trade.
  - An invalid room code shows a recovery path.
- **Load test** (`npm run load-test`): the room payload is now bounded (seated players and host plus the first 24
  spectators, and the last 25 feed items).
- **QT experiment** (`npm run experiment`, `experiments/`): paired seeded replays compare a fixed-spread quoter with an
  inventory-aware quoter at informed shares of 0, 0.25, 0.5 and 0.75. The skew is tuned on separate seeds. Results are
  in `experiments/RESULTS.md`.

## Results
**Load** (one process, server and clients on the same Mac; latency = order sent → every spectator socket has the trade):

| spectators | trades | p50 | p95 | client MB received | RSS |
|---|---|---|---|---|---|
| 200 | 20 | 23.4 ms | 30.0 ms | 205 | 154 MB |
| 500 | 10 | 44.2 ms | 61.0 ms | 940 | 213 MB |

Limits: 2000 sockets per process, 64 KB per message, 30 msg/s per socket (burst 60). There is no product cap on spectators.

**Experiment** (held-out, 400 hands): paired P&L difference, aware − fixed, per hand:

| informed share | 0 | 0.25 | 0.5 | 0.75 |
|---|---|---|---|---|
| aware − fixed | −3.2 ± 2.9 | −8.4 ± 11.8 | −28.2 ± 20.2 | +4.9 ± 23.7 |

No significant expected-P&L benefit. The skew cuts P&L variance by about 11–14% and lowers peak inventory when informed
flow is heavy. Losses to informed traders rise to about −200 per hand at a 0.75 share. The rerun reproduced
`results.json` byte for byte.

## Verification
```
npm run typecheck     # clean
npm run lint          # 0 warnings
npm test              # 83 passed (8 files; +7 trading-bot tests)
npm run e2e           # build + 5 passed (48 s)
npm run load-test 200 20 / 500 10
npm run experiment    # 120 s; identical on rerun
```

## Limitations
- Cross-device play has been verified across independent browser contexts against one local server, not across separate
  physical devices or a hosted deployment, because no hosting is configured. See the README for hosting requirements.
- The load test runs clients in the same process as the server, which is pessimistic for CPU and optimistic for network.
- The trading bots' parameters (edges, sizes) are hand-set, not tuned.
