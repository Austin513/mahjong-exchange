# PR 1 — Plan, room lifecycle, and playable mahjong table

**Branch:** `pr1-table` → `main` · **Depends on:** nothing

## Summary
- `docs/PLAN.md` (architecture, ruleset, market design, PR split, hardest decisions) and `docs/RULES.md`.
- `src/engine`: a server-authoritative, seeded, reduced four-player Riichi engine.
  - Covers chi, pon, open, closed and added kan, riichi and ippatsu, furiten (permanent, temporary and riichi), head-bump multiple ron, exhaustive draw with noten payments, and kan dora.
  - Structural yaku and fu/points come from `@pai-forge/riichi-mahjong@1.1.1` (ISC). The engine adds riichi, ippatsu, haitei, houtei and rinshan.
  - Shanten is my own implementation, cross-checked against the library. On the rare hands where they disagree, hand-checked examples show the library is off by one.
- `src/engine/views.ts`: explicit `publicView` and `seatView` projections. The server never serialises `HandState`.
- `src/bots/mahjong`: smart table bot, random baseline, greedy ablation baseline, and a headless runner.
  - The smart bot minimises shanten, breaks ties by ukeire against visible tiles, and folds against riichi using genbutsu, suji and visible honors. It calls only when the hand keeps a yaku (yakuhai or tanyao).
- `src/server`: in-memory rooms with sessions (128-bit token per participant), 4 seats, host controls, table bots, turn and claim timers, absent-player autopilot, host handoff, and WebSocket transport. Limits: 64 KB per message, 30 msg/s per socket, 2000 sockets per process.
- `src/client`: home page with two game cards, join by code or `/r/CODE`, name entry, live board, private hand with a tap-select-confirm discard, claim buttons, seat list, host panel, feed, and result panel. The layout is responsive.

## Acceptance criteria
- [x] Complete hands are playable with humans and bots. Bots only ever submit legal moves.
- [x] Spectators and other seats never receive a private hand. Hands are revealed only after the hand ends.
- [x] Refreshing or reconnecting reattaches the same identity and seat. The room code alone grants no control of a seat.
- [x] A disconnected seat goes to autopilot after 3 s and the human resumes on reconnect. An expired timer triggers one autopilot move.
- [x] A seeded fixture path (`seed` on room creation, dev/test only) replays exact walls.

## Verification
```
npm run typecheck   # clean
npm run lint        # 0 warnings
npm test            # 40 passed (engine 22, room 11, bots 7)
npm run build       # ok (client 249 KB / 78 KB gzip)
npm run bot-eval 400
```
| matchup | hands | hero win | baseline win / seat | draws | hero deal-in | baseline deal-in / seat |
|---|---|---|---|---|---|---|
| smart vs 3× random | 100 | 57.0% | 0.0% | 43.0% | 0.0% | 13.7% |
| greedy vs 3× random | 100 | 18.0% | 0.0% | 82.0% | 0.0% | 5.3% |
| smart vs 3× greedy | 400 | 31.3% | 12.8% | 30.5% | 4.8% | 17.2% |

Manual check: a production build in headless Chromium at desktop size and 390×844. I created a room, filled the seats with smart bots, dealt and discarded, and joined from a second context as a spectator.

## Limitations
- Reduced ruleset: no abortive draws, chankan, ura-dora, honba, dealer repeats or red fives (see RULES.md).
- Rooms are in memory, so a server restart ends them.
- The market is not in this PR. The trade panel arrives in PR 2.
