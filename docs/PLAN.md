# Mahjong Exchange — Implementation Plan

A multiplayer website: a live four-seat Riichi table plus a play-money market on
who wins each hand. Two games share one engine and one room infrastructure:

- **Trade Against the House**: the house quotes every contract, and players trade against its bid and ask.
- **Open Exchange**: participants and optional trading bots post orders into one book per contract. The house never quotes in this mode.

## Repo findings (start of work)

The folder was empty: no Git history, remote, CI, or repo instructions. The user's
sibling projects use Vite + React + TypeScript + Vitest + oxlint, so this project
follows that stack. There is no remote, so the PRs are local stacked branches. Their
descriptions live in `docs/prs/`.

## Architecture

One Node process (`src/server`) serves the built client and a WebSocket endpoint at `/ws`.
Every room is an isolated object with its own state and its own command queue.

| Layer | Folder | Notes |
|---|---|---|
| Mahjong rules (pure) | `src/engine` | seeded wall, legal actions, claims, scoring, per-seat views |
| Table bots (pure) | `src/bots/mahjong` | input is only a `SeatView` (own tiles + public table) |
| Ledger + matching (pure) | `src/market` | integer ticks, reservations, price-time book, settlement |
| Pricing (pure) | `src/pricing` | public features → conditional-logit probabilities → quotes |
| Trading bots (pure policies) | `src/bots/trading` | every bot submits orders through the room command path |
| Room orchestration | `src/server` | sessions, timers, command queue, broadcasts |
| UI | `src/client` | React; renders only what the server sends |

**Persistence strategy:** rooms live in memory. A restart ends every room, and the README
says so. Rooms with no connections for 2 hours are garbage-collected. All room state is plain
data, so it could be saved as a JSON snapshot. That is a documented future step and is not built.

## Mahjong ruleset (see `docs/RULES.md` for the player-facing version)

The game is four-player Riichi with a stated reduced ruleset. It is not presented as
full competition Riichi.

- 136 tiles, no red fives. 14-tile dead wall, one dora indicator, plus kan dora.
- Calls: chi (left player only), pon, open kan, closed kan, added kan. A call
  forces a discard. There is no swap-call (kuikae) of the same tile kind.
- **Win eligibility:** a complete hand (4 sets + pair, seven pairs, or thirteen orphans)
  with at least one yaku. The library detects structural yaku. The engine adds riichi,
  ippatsu, haitei, houtei and rinshan kaihou. Dora alone is not a yaku.
- **Furiten:** permanent (your own discards include a wait), temporary (you passed a ron
  since your last discard), and riichi furiten. A furiten seat cannot ron and can still tsumo.
- **Riichi:** closed hand, tenpai after the discard, at least 1000 points, at least 4 live
  tiles left. After riichi the player must discard the drawn tile, and closed kan is
  disabled (a simplification).
- **Claim priority:** ron > pon/kan > chi. **Multiple ron uses head bump (atamahane):** only
  the first claimant counting counter-clockwise from the discarder wins. This keeps
  exactly one winner per hand.
- **Draws:** only exhaustive draw. Abortive draws and robbing a kan (chankan) are not implemented.
- Scoring comes from the library's han/fu tables. A hand whose only yaku are situational
  (riichi, ippatsu, haitei, houtei, rinshan) is scored at 30 fu. There is no ura-dora,
  no honba, and the dealer rotates every hand (no repeat dealer). Noten payments of 3000 apply.

## Room lifecycle

`lobby → playing → hand-over → playing …`. The host creates the room and picks the mode.
Anyone with the code or the `/r/CODE` URL enters a display name and joins as a spectator.

- **Sessions:** joining returns a random 128-bit `sessionToken` stored in localStorage
  per room. Every command is authorised from the session's participant id. The room code
  alone grants spectating and nothing else.
- **Seats:** exactly 4. A spectator can claim an empty or bot seat only *between hands*.
  The host can add a smart or random table bot to an empty seat or remove one. A participant
  can hold at most one seat.
- **Reconnect:** the same token reattaches the same participant, seat and ledger account.
  The server sends a fresh snapshot built from that participant's view.
- **Absent player rule:** when a seated human's last connection drops, a smart bot plays
  the seat after a 3 s grace period and the seat shows "away – autopilot". Control returns
  at the next decision once they reconnect. A connected human who idles past the turn timer
  (default 40 s discard, 12 s claim) gets one autopilot decision for that turn only.
- **Spectators:** no product cap. Technical limits: 64 KB max message size, 30 messages
  per second per socket (token bucket), and 2000 sockets per server process. The load test
  size is stated in the PR 3 description.

## Public vs private state

The server holds the full `HandState`. Clients receive **projections** only:

- `PublicTableView`: discards, melds, riichi flags, hand sizes, scores, dora indicators,
  wall count, turn, and whether a claim window is open. It does not say who is eligible to claim.
- `SeatView = PublicTableView + own closed tiles + own legal actions`.

Reconnect snapshots, error messages and the bot inputs use the same functions.
All hands are revealed only *after* settlement. Tests check that spectator
payloads and other seats' payloads never contain a private hand.

## Market design

- **Contracts per hand:** `SEAT_0..SEAT_3` (seat wins) and `DRAW` (exhaustive draw). The
  winning contract pays 100 ticks per share and the others pay 0. The head-bump rule gives
  exactly one winning outcome.
- **Units:** prices are integer ticks from 1 to 99, quantities are integer shares, and
  1 tick = 1 credit. Each account starts with 10,000 credits per room and keeps them across hands.
- **Collateral (fully collateralised, conservative):**
  - *Buy order*: reserves `qty × limit`.
  - *Sell order*: shares covered by an uncommitted long position reserve those shares.
    The uncovered remainder reserves `(100 − limit)` per share.
  - *Short position*: locks `100 × |position|`. Sale proceeds are credited to cash, so the
    net cost is `100 − price`.
  - `available = cash − Σ shortLock − Σ open-order cash reservations`. It is derived, never stored.
  - The ledger (cash + positions) together with the open orders is the single source of truth.
  - An order is rejected when its reservation is larger than `available`.
  - Each fill releases its reservation at the limit price and books the trade at the resting price.
- **Settlement:** it runs inside the same synchronous room command that applies the winning
  or exhaustive-draw action. That command cancels all orders (releasing reservations),
  pays `100 × position` on the winning contract, and zeroes positions. Settlement is keyed
  by `handId`, so a retried command finds the hand already settled and does nothing.
- **Worked example:** buy 10 @ 32. A win nets +680 for the buyer and −680 for the seller.
  If the contract expires worthless, the buyer nets −320 and the seller +320. Both cases are tests.

### House mode

The house is a ledger account with a large bankroll. Its quotes are real resting orders
in the same matching engine. A player's click sends an **immediate-or-cancel limit at the
price they saw**. If the quote moved in their favour they get the better resting price.
If it moved against them, nothing fills and the server returns the refreshed quote. Players
cannot post resting orders in House mode.

**Fair value:** a conditional multinomial logit over the five outcomes, using only public
features. Per seat: dealer, riichi, how long since the riichi, open melds (and open melds ×
wall progress), an exposed yakuhai set, the tsumogiri streak, and the number of other seats in
riichi. For the draw: wall progress, 1/(live tiles + 1), and the riichi count. It is fitted on
bot self-play (`npm run fit-model`) and validated on held-out seeds against a base-rate prior
and a time + dealer ablation (log loss, Brier score, calibration; see `docs/MODEL.md`). The softmax makes the five probabilities sum to 1.
**Quote:** `fv = 100·p`. `mid = fv − skew·inventory` (the inventory-aware policy). Bid and
ask are `mid ∓ halfSpread`, rounded outward and clamped to 1–99. Size is fixed per refresh.
Each quote carries the table `stateVersion`. Pricing runs from a deferred task, and a result
for an older version is thrown away. The UI shows the fair-value series and names the
public event that moved it.

### Open Exchange

One price-time-priority book per contract. A marketable order fills against the best prices
up to its limit, at the resting price. **Self-trade prevention:** cancel the resting order
(expire-maker). When an incoming order would match the same account's resting order, that
resting order is cancelled and reported, and matching continues. GTC orders rest until filled,
cancelled or settled. IOC is optional. Every room command runs synchronously on the room
queue, so two clicks cannot fill the same shares twice or race settlement.

## Bots

- **Table bot (smart):** minimises shanten. It breaks ties by ukeire counted against the
  tiles still unseen from its own view, then by tile value (honors and terminals first).
  It always declares a win when legal. It riichis when tenpai and closed. It calls pon on
  yakuhai and makes other calls only when the hand stays all-simples (tanyao) or already has
  a yakuhai and the call lowers shanten. **Defence:** when another seat is in riichi and the
  bot is 2 or more shanten, it discards the safest tile: genbutsu, then suji or honors with
  3 or more visible, then everything else. **Random bot:** picks a uniform random legal move.
  Its purpose is to be the baseline.
- **Trading bots (Open Exchange; the host sets the count of each and the pace):**
  - *Informed*: attached to a bot-controlled seat. It reads that seat's private hand
    (shanten and ukeire) and trades when its private-model edge beats the price.
  - *Public*: uses the house's public model and quotes around fair value.
  - *Noise*: trades for scheduled liquidity needs and inventory reduction, independent of the hand.
  - *Random*: bounded random actions from a seeded RNG.

## Verification

Unit tests cover the engine, views, bots, ledger, book, pricing and room. A WebSocket
integration test runs independent clients through both modes, including a human-to-human
fill with no bots. Playwright drives independent browser contexts through a full hand in each
mode, including a 390×844 mobile viewport. There is also a load test of N spectator sockets
and the QT experiment (`npm run experiment`).

## PR breakdown

| PR | Branch | Contents | Acceptance | Depends on |
|---|---|---|---|---|
| 1 | `pr1-table` | plan, rules, engine, views, table bots, rooms/sessions/reconnect, table UI | complete hands with humans and bots, private-state tests pass, `npm run build && npm test` green | — |
| 2 | `pr2-market` | ledger, matching, settlement, House pricing + quoter, Open Exchange UI | worked-example tests, priority/partial/STP/stale-quote tests, settlement atomic and idempotent | 1 |
| 3 | `pr3-bots-e2e` | four trading bots, Playwright e2e, load test, polish, QT experiment | e2e green in both modes + mobile, experiment output committed | 2 |

## Hardest decisions

1. **Settlement atomicity.** The win or draw is applied, and the market is closed and settled,
   in one synchronous function on the room queue. No await sits between them, so no order can
   slip in after the outcome is final. Settlement is keyed by `handId` for idempotency.
2. **Hidden tiles.** The server never serialises `HandState`. Every outbound payload is built by
   `publicView` or `seatView`, bots receive the same `SeatView`, and the house and public bots
   receive only `PublicTableView`. Errors never echo state.
3. **House fair prices.** Sampling hidden hands at random would make real hands look
   unrealistically slow. Instead, the model is a logit fitted on self-play outcomes with only
   observable features as inputs. It is fast, interpretable through its coefficients, sums to one
   by construction, and is validated out-of-sample.
