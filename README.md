# Mahjong Exchange

What happens when you combine mahjong and trading into one online game?

Four people (or bots) sit down and play a hand of Riichi mahjong. Everyone else in the room trades on who's going to
win it, and the players can trade too. Somebody calls riichi and their price jumps. The wall runs low and the draw
gets more expensive. When the hand ends, the market settles and you find out who read the table best.

It's all play money. There are no accounts. You make a room, send the link, and your friends are in.

## Two modes

**Trade against the house.** The house quotes a bid and an ask on every outcome and re-prices after every discard,
call and riichi. You're trying to beat its model.

**Open exchange.** No house. You and your friends post your own bids and asks and make the market yourselves. If
nobody's quoting, you can be the first one. You can also add trading bots if the room is quiet.

Each hand has five contracts: seat A wins, B wins, C wins, D wins, or the hand ends in a draw. The winner pays 100
credits a share and the rest pay nothing, so a price of 32 is the market saying "about 32%".

## Running it

You need Node 20 or newer.

```bash
git clone https://github.com/Austin513/mahjong-exchange.git
cd mahjong-exchange
npm install
npm run build && npm start
```

Then open http://localhost:5175.

If you're working on the code, `npm run dev` gives you hot reload.

If it crashes with `EADDRINUSE`, there's an old server still running on that port. Kill it with
`lsof -ti tcp:5175 | xargs kill` and start again.

## Playing with friends

On the same Wi-Fi, friends can open `http://<your-ip>:5175`. On a Mac, `ipconfig getifaddr en0` gives you the IP.

If they're somewhere else, the easiest option is a Cloudflare tunnel. Leave the server running and in a second
terminal run:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5175
```

It prints a `trycloudflare.com` link you can send around. It works for as long as both terminals stay open.

If you want it up all the time, put it on anything that runs a Node server with WebSockets: Render, Railway,
Fly.io or a VPS. GitHub Pages and Netlify won't work because the game needs its server. Set the build command to
`npm install --include=dev && npm run build` and the start command to `npm start`, and run a single instance.

Two things to keep in mind. Rooms live in memory, so restarting or redeploying the server ends every game in
progress, and free tiers that go to sleep do the same thing. There's also no limit on who can create rooms, so
anyone with the link can.

## How a game goes

1. Enter a name on the home page and create a House room or an Exchange room.
2. Hit **Copy invite** and send it to people, or just tell them the five-letter code. They join as spectators and
   can start trading right away. Between hands they can take an empty seat, or a seat a bot is sitting in.
3. Fill any empty seats with bots. Smart bots play properly and random bots are mostly there for comparison. If
   they're playing too fast to follow, turn the bot speed down to Slow or Very slow under Table timing.
4. Deal. To discard, tap a tile and then hit Discard, or just tap the same tile twice. Pon, chi, kan, ron, riichi
   and tsumo buttons only show up when you're actually allowed to use them.
5. Trade. In a House room you pick a size and hit Buy or Sell, and each button shows exactly what it'll cost. The
   chart next to it shows how the house's fair value has moved and what moved it. In an Exchange room you pick a
   contract, set your side, price and size, and your order sits in the book until someone takes it.
6. When someone wins (or the wall runs out), trading stops right away and you get the result, the payout and
   your P&L for the hand. Your balance carries into the next hand.

Everyone starts with 10,000 credits per room. Every position is paid for up front, so you can never end up owing
more than you have, even if you go short.

## Things worth knowing

The mahjong is real four-player Riichi with calls, riichi, ippatsu, furiten, multiple ron and kan dora. It's not
the full competition ruleset, though. There are no abortive draws, chankan, ura-dora, honba, dealer repeats or
red fives. [docs/RULES.md](docs/RULES.md) has the details, and you can read it in the app at `/rules`.

Your tiles never leave the server unless they're yours. Spectators and other players only get the public table,
and everyone's hand is revealed after the hand settles.

If you close the tab mid-hand, a bot covers your seat until you come back. You get the same seat and the same
balance when you return.

The house model was fitted on a lot of bot-vs-bot games and checked against games it hadn't seen.
[docs/MODEL.md](docs/MODEL.md) has the numbers. [experiments/RESULTS.md](experiments/RESULTS.md) compares a house
that shifts its quotes based on its inventory with one that keeps a fixed spread.

If you want to see how it's put together, [docs/PLAN.md](docs/PLAN.md) covers the architecture and the hardest
decisions, and [docs/prs/](docs/prs/) has a write-up for each stage of the build.

## Commands

| | |
|---|---|
| `npm test` | unit and integration tests |
| `npm run e2e` | build, then run the Playwright browser tests |
| `npm run typecheck` / `npm run lint` | TypeScript and oxlint |
| `npm run bot-eval [hands]` | smart vs random vs greedy table bots |
| `npm run fit-model [train] [holdout]` | refit the house model on self-play |
| `npm run experiment` | the house quoting experiment |
| `npm run load-test [spectators] [trades]` | how fast updates reach a crowd of spectators |

The Playwright tests need Chromium installed first:
`PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium`.

## Where things are

```
src/engine         mahjong rules, scoring, and what each player is allowed to see
src/bots/mahjong   table bots
src/bots/trading   trading bots
src/market         accounts and the order book
src/pricing        the house's fair-value model and quoting
src/server         rooms, sessions, timers, WebSockets
src/client         the React app
```

Built with TypeScript, React, Vite and Node. Hand scoring comes from
[@pai-forge/riichi-mahjong](https://www.npmjs.com/package/@pai-forge/riichi-mahjong).
