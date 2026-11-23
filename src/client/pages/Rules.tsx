export function Rules({ navigate }: { navigate: (to: string) => void }) {
  return (
    <div className="rules">
      <button className="btn btn-sm" onClick={() => navigate("/")}>
        ← Home
      </button>
      <h1>Rules</h1>
      <h2>The table — reduced four-player Riichi</h2>
      <p>
        <b>This is a reduced ruleset, not the full competition rules.</b> 136 tiles (no red fives), a 14-tile dead wall, and one dora indicator plus kan dora.
      </p>
      <ul>
        <li>
          <b>Goal:</b> four sets + a pair (or seven pairs / thirteen orphans) with at least one <i>yaku</i>. Dora alone is not a yaku.
        </li>
        <li>
          <b>Turn:</b> draw one, discard one. Tap a tile, then press Discard (or tap the same tile twice).
        </li>
        <li>
          <b>Calls:</b> Ron &gt; Pon/Kan &gt; Chi. Only the next player can chi. After chi/pon you must discard, but not the same tile kind you just called.
        </li>
        <li>
          <b>Multiple ron:</b> head bump — only the first claimant counter-clockwise from the discarder wins. Every hand has exactly one winner or a draw.
        </li>
        <li>
          <b>Furiten:</b> you can't ron if a wait is in your own discards, if you passed a ron since your last draw, or if you passed one after riichi. Tsumo still works.
        </li>
        <li>
          <b>Riichi:</b> closed and tenpai, 1000+ points, 4+ tiles left. +1 han (ippatsu +1 more). After riichi you must discard what you draw.
        </li>
        <li>
          <b>Situational yaku added by the engine:</b> riichi, ippatsu, haitei, houtei, rinshan kaihou. Structural yaku and fu come from the open-source @pai-forge/riichi-mahjong library.
        </li>
        <li>
          <b>Draw:</b> if the wall runs out, the hand is a draw. Tenpai players receive 3000 points in total from the non-tenpai players.
        </li>
        <li>
          <b>Not implemented:</b> abortive draws, chankan, ura-dora, honba, dealer repeats (the dealer rotates every hand), red fives, nagashi mangan, suji-swap restriction.
        </li>
      </ul>
      <h2>The market</h2>
      <ul>
        <li>
          Five contracts per hand: <b>Seat A, B, C, D wins</b> and <b>Draw</b>. The winning one pays <b>100 credits/share</b>; the others pay 0. Mahjong points never change the payout.
        </li>
        <li>Prices are 1–99 credits (read them as percent probability). Everyone starts with 10,000 play credits per room.</li>
        <li>
          Everything is fully collateralised: buying reserves price×qty; selling shares you don't own reserves (100−price)×qty; a filled short locks 100/share until settlement.
        </li>
        <li>Trading closes the instant the hand ends; open orders are cancelled and the winning contract pays out exactly once.</li>
        <li>
          Example: buy 10 at 32 → if it wins you net <b>+680</b> (seller −680); if it loses you net <b>−320</b> (seller +320).
        </li>
        <li>
          <b>House mode:</b> you trade at the house's bid/ask. Your click is a limit at the price you saw — you get that price or better, or nothing and a refreshed quote.
        </li>
        <li>
          <b>Open Exchange:</b> price-time priority, fills at the resting price, self-trade prevention cancels your own resting order. No house liquidity.
        </li>
      </ul>
    </div>
  );
}
