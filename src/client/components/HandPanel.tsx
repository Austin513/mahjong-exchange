import { useEffect, useState } from "react";
import type { PrivateSeatInfo, PublicTableView } from "../../engine/views";
import type { Action } from "../../engine/types";
import type { RoomView } from "../../shared/protocol";
import { kindOf } from "../../engine/tiles";
import { Tile, shortLabel } from "./Tile";
import { useCountdown } from "./useCountdown";

interface Props {
  me: PrivateSeatInfo;
  table: PublicTableView;
  room: RoomView;
  act: (a: Action) => void;
}

export function HandPanel({ me, table, room, act }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const legal = me.legal;
  const myTurn = legal.discard.length > 0;
  const left = useCountdown(room.deadlines[me.seat], room.serverNow);

  useEffect(() => setSelected(null), [table.version]);

  const closed = me.drawnTile !== null ? me.hand.filter((t) => t !== me.drawnTile) : me.hand;
  const canDiscard = (t: number) => legal.discard.includes(t);

  const onTile = (t: number) => {
    if (!myTurn || !canDiscard(t)) return;
    if (selected === t) {
      act({ type: "discard", tile: t });
      setSelected(null);
    } else setSelected(t);
  };

  const riichiOk = selected !== null && legal.riichi.includes(selected);
  const claimTile = table.claim?.tile;

  return (
    <section className="hand-panel" aria-label="Your hand" data-testid="hand-panel">
      <div className="hand-status">
        {myTurn && <strong className="your-turn">Your turn — tap a tile, then Discard (or tap it twice).</strong>}
        {legal.claim.length > 0 && claimTile !== undefined && (
          <strong className="your-turn">
            Claim <Tile tile={claimTile} size="sm" />?
          </strong>
        )}
        {!myTurn && legal.claim.length === 0 && table.phase !== "ended" && <span className="muted">Waiting for other players…</span>}
        {left !== null && (myTurn || legal.claim.length > 0) && <span className="countdown" data-testid="my-countdown">{left}s</span>}
        {me.waits.length > 0 && (
          <span className={`waits ${me.furiten ? "furiten" : ""}`}>
            Tenpai · waits {me.waits.map(shortLabel).join(" ")}
            {me.furiten && " · FURITEN (no ron)"}
          </span>
        )}
      </div>
      <div className="hand-tiles" data-testid="my-hand">
        {closed.map((t) => (
          <Tile key={t} tile={t} size="lg" onClick={() => onTile(t)} selected={selected === t} disabled={!myTurn || !canDiscard(t)} testId={`hand-tile-${t}`} />
        ))}
        {me.drawnTile !== null && (
          <span className="drawn-gap">
            <Tile tile={me.drawnTile} size="lg" onClick={() => onTile(me.drawnTile!)} selected={selected === me.drawnTile} disabled={!myTurn || !canDiscard(me.drawnTile)} testId={`hand-tile-${me.drawnTile}`} />
          </span>
        )}
      </div>
      <div className="hand-actions">
        {myTurn && (
          <>
            <button className="btn btn-primary" disabled={selected === null} onClick={() => selected !== null && act({ type: "discard", tile: selected })} data-testid="btn-discard">
              Discard{selected !== null ? ` ${shortLabel(kindOf(selected))}` : ""}
            </button>
            {legal.riichi.length > 0 && (
              <button className="btn btn-riichi" disabled={!riichiOk} title={riichiOk ? "" : "Select a tile that keeps you tenpai"} onClick={() => selected !== null && act({ type: "discard", tile: selected, riichi: true })} data-testid="btn-riichi">
                Riichi{riichiOk ? ` + discard ${shortLabel(kindOf(selected!))}` : " (select tile)"}
              </button>
            )}
          </>
        )}
        {legal.tsumo && (
          <button className="btn btn-win" onClick={() => act({ type: "tsumo" })} data-testid="btn-tsumo">
            TSUMO — win
          </button>
        )}
        {legal.ankan.map((k) => (
          <button key={`a${k}`} className="btn" onClick={() => act({ type: "ankan", kind: k })}>
            Closed kan {shortLabel(k)}
          </button>
        ))}
        {legal.kakan.map((k) => (
          <button key={`k${k}`} className="btn" onClick={() => act({ type: "kakan", kind: k })}>
            Added kan {shortLabel(k)}
          </button>
        ))}
        {legal.claim.map((o, i) => {
          if (o.type === "ron")
            return (
              <button key={i} className="btn btn-win" onClick={() => act({ type: "ron" })} data-testid="btn-ron">
                RON — win
              </button>
            );
          if (o.type === "minkan")
            return (
              <button key={i} className="btn" onClick={() => act({ type: "minkan" })}>
                Kan
              </button>
            );
          return (
            <button key={i} className="btn" onClick={() => act({ type: o.type, tiles: o.tiles })} data-testid={`btn-${o.type}`}>
              {o.type === "pon" ? "Pon" : "Chi"} <span className="mini-tiles">{o.tiles.map((t) => shortLabel(kindOf(t))).join(" ")}</span>
            </button>
          );
        })}
        {legal.claim.length > 0 && (
          <button className="btn btn-ghost" onClick={() => act({ type: "pass" })} data-testid="btn-pass">
            Pass
          </button>
        )}
      </div>
    </section>
  );
}
