# Mahjong Exchange

A multiplayer website that combines a live four-seat Riichi mahjong table with a play-money market on who wins each
hand. One engine and one room system power two games:

- **Trade Against the House**: the house quotes a bid and ask on every outcome and re-prices from public information.
- **Open Exchange**: friends (and optional trading bots) post their own bids and asks into one order book per contract.

All money is virtual credits.

## Run it

Requires Node 20+ (developed on Node 26). Everything installs into the project folder.

```bash
npm install
npm run build && npm start      # production build on http://localhost:5175
# or, while developing:
npm run dev                      # Vite HMR + the same WebSocket server, seeded test rooms allowed
```

**Playing with friends on other devices.** The server listens on `0.0.0.0:5175` (set `PORT` / `HOST` to change it).
- On the same Wi-Fi, friends open `http://<your-computer's-LAN-IP>:5175/r/CODE`.
- Over the internet, run `npm run build && npm start` on any host that supports long-lived WebSocket connections
  (one Node process; sticky sessions are not needed because there is one process). Put it behind HTTPS; the client
  switches to `wss://` automatically.
- Rooms are held in memory, so a restart ends all rooms. A static host alone will not work: the game needs the Node server.

## How to play

1. **Start a lobby.** On the home page, enter a display name and click **Create House room** or **Create Exchange room**.
2. **Invite friends.** Click **Copy invite** (or read out the 5-letter room code). Friends open the link, pick a name,
   and join as spectators. They can trade immediately and claim an empty or bot seat between hands. Each browser gets
   its own private session token, so knowing the code does not let anyone act for your seat.
3. **Fill seats with smart bots.** In **Table seats**, the host clicks **Fill empty seats with smart table bots** (or
   **+ Smart bot** / **+ Random bot** per seat). *Table bots* play tiles. *Trading bots* are a separate setting that
   only trades.
4. **Deal.** The host clicks **Deal the first hand**, then **Start next hand** after each result. Seated players tap a
   tile, then **Discard** (or tap the same tile twice). Ron, Pon, Chi, Kan, Riichi and Tsumo buttons appear only when
   they are legal.
5. **Trade against the house.** In a House room, pick a size (1, 5, 10 or 25) and click a **Buy** (ask) or **Sell** (bid)
   button. Each button shows the price and the total cost. "Why prices moved" and the fair-value chart show the model's
   reaction to the last public event.
6. **Open a friends-only exchange.** In an Exchange room, leave every trading-bot count at 0. Choose a contract tab, set
   side, price and size in the ticket (it previews how many credits the order reserves), and place the order. It rests
   in the book until someone trades against it. Status chips show resting, partially filled, filled or cancelled.
   Optionally enable informed, public, noise or random trading bots under **Host controls → Trading bots**.
7. **Settlement.** When the hand ends, trading closes in the same server step. The result panel shows the winner (or the
   draw), the payout per contract, your final positions and your P&L.

## Rules and design docs

| Doc | Contents |
|---|---|
| [docs/RULES.md](docs/RULES.md) (also `/rules` in the app) | the exact reduced Riichi ruleset and market rules |
| [docs/PLAN.md](docs/PLAN.md) | architecture, state isolation, collateral model, the hardest decisions |
| [docs/MODEL.md](docs/MODEL.md) | the house fair-value model: coefficients and held-out validation |
| [experiments/RESULTS.md](experiments/RESULTS.md) | the QT experiment: inventory-aware vs fixed-spread quoting |
| [docs/prs/](docs/prs/) | PR descriptions with verification and limitations |

**The ruleset is reduced four-player Riichi, not full competition rules.** It has calls, riichi and ippatsu, furiten,
head-bump multiple ron, exhaustive draw and kan dora. Structural yaku and fu come from `@pai-forge/riichi-mahjong`.
It has no abortive draws, chankan, ura-dora, honba, dealer repeats or red fives.

## Commands

| command | what it does |
|---|---|
| `npm test` | unit + integration tests (Vitest) |
| `npm run e2e` | build, then Playwright browser tests (independent contexts, mobile viewport) |
| `npm run typecheck` / `npm run lint` | TypeScript and oxlint |
| `npm run bot-eval [hands]` | table-bot strength: smart vs random vs greedy |
| `npm run fit-model [train] [holdout]` | refit the house model on self-play; writes coefficients + docs/MODEL.md |
| `npm run experiment` | QT experiment (writes experiments/results.json + results-table.md) |
| `npm run load-test [spectators] [trades]` | fan-out latency with N spectator sockets |

Playwright's browser installs into `node_modules` (`PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium`).

## Layout

```
src/engine         rules: wall, legal actions, claims, scoring, per-seat views (pure)
src/bots/mahjong   smart / greedy / random table bots + headless runner
src/bots/trading   informed / public / noise / random trading bot policies (pure)
src/market         ledger + price-time matching engine (pure)
src/pricing        public-feature conditional logit, informed seat model, house quoter
src/server         rooms, sessions, timers, market room, trading bots, HTTP/WebSocket
src/client         React UI
tests/ e2e/ scripts/ experiments/ docs/
```
