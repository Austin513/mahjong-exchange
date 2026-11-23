# QT experiment — inventory-aware vs fixed-spread house quoting (SIMULATION)

**Question.** As the share of informed order flow rises, does an inventory-aware house quoter lose less to informed
traders, or earn more settled P&L, than a fixed-spread quoter that uses the same fair value and the same spread?

**Reproduce.**
```bash
npm run experiment            # uses experiments/config.json (~2 min)
```
This writes `experiments/results.json` (full numbers) and `experiments/results-table.md` (the tables below).
The code is in `scripts/experiment.ts`.

## Setup
- **Hands:** smart-bot self-play, seeded. 150 tuning hands (`qt-tune-*`) and 400 **held-out** hands (`qt-eval-*`).
  Neither seed set overlaps the model's training or validation seeds.
- **House:** fair value comes from the production public model (`src/pricing/model.ts`). Quotes are fair ± 3 ticks,
  20 shares per side, with an inventory cap of 400.
  - *Fixed:* skew 0.
  - *Inventory-aware:* mid = fair − skew × inventory. The skew is chosen from a grid on the **tuning** seeds at an
    informed share of 0.25, which picked 0.08 ticks per share.
- **Order flow:** at each discard, a trader arrives with probability 0.5 and sends a 10-share IOC at the house quote.
  - With probability = *informed share*, the trader is informed. It sees one seat's private hand, uses the fitted
    informed model, and trades the single best edge if it beats the quote by more than 1 tick. Otherwise it passes.
  - The other arrivals are noise traders who buy or sell a random contract regardless of price.
- **Pairing:** deals, the public event sequence, and every random draw for trader opportunities (arrival, type, seat,
  contract, side) are identical across both policies and all informed shares. Each policy runs its own production
  `Exchange` (same ledger and matching engine), so its own quotes produce its own fills.
- **Markout:** the reference value is the settlement value (100 if the contract won, else 0) and the horizon is the end
  of the hand. The sign is from the house's view (positive = house gained). Settled house P&L equals the sum of the
  markouts; the code asserts this.

## Results (held-out, 400 hands; ± is the standard error)
| informed share | fixed P&L / hand | inventory-aware P&L / hand | paired diff (aware − fixed) | fill rate (fixed / aware) | informed fill rate | P&L vs informed | P&L vs noise | mean max abs inventory |
|---|---|---|---|---|---|---|---|---|
| 0 | 965.2 ± 88.3 | 962.0 ± 88.4 | -3.2 ± 2.9 | 1.000 / 1.000 | 0.000 / 0.000 | 0.0 / 0.0 | 965.2 / 962.0 | 36.3 / 36.3 |
| 0.25 | 647.3 ± 84.4 | 638.9 ± 81.0 | -8.4 ± 11.8 | 0.828 / 0.832 | 0.283 / 0.300 | -71.8 / -78.2 | 719.0 / 717.0 | 33.2 / 32.2 |
| 0.5 | 293.0 ± 81.1 | 264.8 ± 72.1 | -28.2 ± 20.2 | 0.648 / 0.649 | 0.294 / 0.297 | -178.0 / -203.8 | 471.0 / 468.5 | 30.6 / 28.3 |
| 0.75 | 17.4 ± 80.8 | 22.3 ± 69.5 | 4.9 ± 23.7 | 0.472 / 0.463 | 0.301 / 0.289 | -199.8 / -193.4 | 217.2 / 215.7 | 29.8 / 25.6 |

The fill rate is fills per trader arrival. The informed fill rate is the share of informed arrivals that found an edge
and traded. P&L vs informed and vs noise split the settled P&L by counterparty.

## Interpretation
1. **Informed flow is costly, and the cost grows with its share.** Under either policy, P&L lost to informed traders
   rises from 0 to about −200 credits per hand as the informed share goes from 0 to 0.75. Meanwhile the spread earned
   from noise traders shrinks with their share, from about 965 to about 216. At 0.75 the house roughly breaks even.
2. **The inventory skew did not improve expected P&L here.** No paired difference is distinguishable from zero (all are
   within about 1.4 SE). The point estimate is slightly negative at shares of 0.25 and 0.5 and slightly positive at 0.75.
   The tuning grid already showed P&L flat to declining as the skew rises.
3. **The skew lowers risk once informed flow is heavy.** At shares of 0.5–0.75, the standard deviation of per-hand P&L
   is about 11–14% lower (SE 72 vs 81 and 70 vs 81), and mean peak inventory falls from about 30 to 26–28 shares.
   With little informed flow there is essentially no difference.
4. **Why the effect is small.** Trades are small (10 shares) relative to the 400-share cap, and each hand is short
   (about 25 arrivals), so inventory rarely builds up enough for the skew to matter. The informed model's edge is also
   modest: it trades on only about 30% of its opportunities. In this setup inventory management mostly reduces variance,
   while the half-spread is the main lever on expected P&L. A natural follow-up is to tune the spread against the
   informed share.

*All numbers are simulation results on bot self-play, not real trading. They describe this harness, not a general claim
about market making.*
