# Game rules — Mahjong Exchange

## The table: reduced four-player Riichi

This is a **reduced** ruleset. It is not the full competition rules.

**Tiles.** 136 tiles: characters (萬), dots (筒), and bamboo (索) numbered 1–9, four winds,
and three dragons, four copies of each. There are no red fives. 14 tiles form the dead wall.
One dora indicator is flipped at the start of the hand, plus one more after each kan.

**Goal.** Complete a 14-tile hand: four sets (runs like 3-4-5 of one suit, or triplets) plus one pair.
Seven pairs and thirteen orphans also count. A winning hand needs at least one yaku (scoring pattern).
Dora alone is not a yaku.

**Turn.** Draw one tile, then discard one. The dealer starts with 14 tiles.

**Calls on a discard.** Priority runs **Ron > Pon / Kan > Chi**.
- *Chi*: make a run using the discard. Only the next player in turn order can chi.
- *Pon*: make a triplet. Anyone can pon.
- *Kan*: make a quad. Open kan from a discard, added kan onto your own pon, or closed kan from your own tiles.
  After a kan you draw a replacement tile and a new dora indicator is flipped.
- After chi or pon you must discard, and you cannot discard the tile kind you just called.

**Winning.**
- *Tsumo*: you complete the hand with your own draw.
- *Ron*: you complete the hand with another player's discard.
- **Multiple ron (head bump):** if several players ron the same discard, only the first one counter-clockwise
  from the discarder wins. Every hand therefore has exactly one winner or a draw.
- **Furiten:** you cannot ron if (a) one of your waits is in your own discard pile, (b) you passed a ron since your
  last draw, or (c) you passed a ron after declaring riichi. You can still win by tsumo.

**Riichi.** A closed hand that is one tile from winning (tenpai), with at least 1000 points and at least 4 tiles
left in the wall, may declare riichi. Riichi pays a 1000-point stick and adds 1 han. Ippatsu adds another han
for a win within one go-around with no calls. After riichi you must discard every tile you draw unless it wins.
Closed kan after riichi is disabled (a simplification).

**Yaku.** Structural yaku come from `@pai-forge/riichi-mahjong`: tanyao, pinfu, iipeikou, yakuhai, sanshoku,
ittsu, chanta, junchan, chiitoitsu, toitoi, sanankou, honitsu, chinitsu, yakuman, and more. The engine adds
riichi, ippatsu, haitei (tsumo on the last tile), houtei (ron on the last discard), and rinshan kaihou (win on
a kan replacement draw).

**Draws.** When the live wall runs out with no winner, the hand is an **exhaustive draw**. Players who are tenpai
receive 3000 points in total, paid by the players who are not.

**Scoring.** Han and fu from the library's tables. Points move but **do not affect the market**: the market pays on
*who wins*, not on how much.

**Not implemented:** abortive draws (nine terminals, four winds, four riichi, four kans), robbing a kan (chankan),
ura-dora, honba counters, dealer repeats (the dealer rotates every hand), red fives, nagashi mangan, and the
suji-swap call restriction. The round wind is East for hands 1–4, then South for hands 5–8, and so on.

## The market

**Contracts.** Every hand lists five contracts: **Seat A wins, Seat B wins, Seat C wins, Seat D wins, Draw**.
Exactly one of them pays **100 credits per share** when the hand ends. The other four pay 0.

**Prices** are whole numbers from 1 to 99 credits, so a price reads directly as a probability in percent.
Quantities are whole shares. Every account starts with **10,000 play credits** per room, and the balance
carries across hands.

**Collateral.** Every position is fully funded up front, so no one can owe more than they have.
- Buying reserves `price × qty`.
- Selling shares you hold reserves those shares.
- Selling shares you don't hold opens a short. It reserves `(100 − price) × qty` while the order is open, and
  a filled short locks 100 per share until settlement. The sale proceeds are already in your cash.
- *Available* = cash − short collateral − reservations for open orders. An order that needs more than your
  available credits is rejected.

**Settlement.** When the winning tile is declared (or the wall runs out), trading closes in the same server step.
Open orders are cancelled and their reservations released. Each share of the winning contract pays 100 and the
other contracts pay 0. Settlement happens exactly once.

*Example:* you buy 10 shares at 32. If that contract wins you get 1000 back, a net **+680**, and the seller nets
**−680**. If it loses you net **−320** and the seller **+320**.

### Trade Against the House
The house quotes a bid and an ask on every contract and is the only counterparty. When you click Buy or Sell, your
order is a limit at the price you saw. If the quote moved in your favour you get the better price. If it moved
against you, nothing trades and you see the refreshed quote.

### Open Exchange
There is one order book per contract, with price-time priority. Orders trade at the resting order's price.
If your incoming order would trade against one of your own resting orders, that resting order is cancelled
(self-trade prevention) and matching continues. There is no house liquidity: if the book is empty, post the
first quote.
