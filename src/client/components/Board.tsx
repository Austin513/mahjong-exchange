import type { PublicTableView } from "../../engine/views";
import type { Meld } from "../../engine/types";
import type { RoomView } from "../../shared/protocol";
import { seatName } from "../../shared/protocol";
import { Tile } from "./Tile";
import { useCountdown } from "./useCountdown";

const WIND_CHAR: Record<number, string> = { 27: "東 East", 28: "南 South", 29: "西 West", 30: "北 North" };

function occupantLabel(room: RoomView, seat: number): { name: string; tag: string; away: boolean } {
  const o = room.seats[seat];
  if (!o) return { name: "Empty", tag: "", away: false };
  if (o.kind === "bot") return { name: o.name, tag: o.bot === "smart" ? "table bot" : "random bot", away: false };
  return { name: o.name, tag: o.connected ? "human" : "offline", away: o.away };
}

function MeldView({ meld }: { meld: Meld }) {
  return (
    <span className="meld" aria-label={`${meld.type} meld`}>
      {meld.tiles.map((t, i) =>
        meld.type === "ankan" && (i === 0 || i === 3) ? <Tile key={t} back size="sm" /> : <Tile key={t} tile={t} size="sm" sideways={t === meld.called && meld.type !== "kakan"} />,
      )}
    </span>
  );
}

interface SeatAreaProps {
  table: PublicTableView;
  room: RoomView;
  seat: number;
  position: "bottom" | "right" | "top" | "left";
  isYou: boolean;
}

function SeatArea({ table, room, seat, position, isYou }: SeatAreaProps) {
  const s = table.seats[seat];
  const occ = occupantLabel(room, seat);
  const acting = table.phase === "discard" && table.turn === seat;
  const deadline = room.deadlines[seat];
  const left = useCountdown(deadline, room.serverNow);
  const lastDiscard = table.claim && table.claim.from === seat;
  return (
    <section className={`seat seat-${position} ${acting ? "seat-acting" : ""}`} aria-label={`${seatName(seat)} ${occ.name}`} data-testid={`seat-${seat}`}>
      <header className="seat-head">
        <span className="seat-wind">{WIND_CHAR[s.wind]}</span>
        {table.dealer === seat && <span className="badge badge-dealer" title="Dealer">Dealer</span>}
        <span className="seat-name">
          {occ.name}
          {isYou && <span className="you-tag"> (you)</span>}
        </span>
        <span className={`seat-tag ${occ.tag === "human" ? "" : "muted"}`}>{occ.away ? "away · autopilot" : occ.tag}</span>
        {s.riichi && <span className="badge badge-riichi">RIICHI</span>}
        <span className="seat-score">{s.score.toLocaleString()}</span>
        {acting && <span className="turn-pill">{left !== null ? `turn · ${left}s` : "turn"}</span>}
        {!acting && left !== null && table.phase === "claim" && <span className="turn-pill claim">deciding · {left}s</span>}
      </header>
      <div className="seat-body">
        {!isYou && (
          <div className="concealed" aria-label={`${s.handCount} concealed tiles`}>
            {table.revealedHands ? (
              table.revealedHands[seat].map((t) => <Tile key={t} tile={t} size="xs" />)
            ) : (
              <>
                {Array.from({ length: Math.min(s.handCount, 14) }, (_, i) => (
                  <Tile key={i} back size="xs" />
                ))}
              </>
            )}
          </div>
        )}
        {s.melds.length > 0 && (
          <div className="melds">
            {s.melds.map((m, i) => (
              <MeldView key={i} meld={m} />
            ))}
          </div>
        )}
        <div className="pond" aria-label={`${seatName(seat)} discards`}>
          {s.discards.map((d, i) => (
            <Tile
              key={d.tile}
              tile={d.tile}
              size="sm"
              riichi={d.riichi}
              dim={d.calledBy !== null}
              glow={!!lastDiscard && i === s.discards.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Board({ table, room, perspective, youSeat }: { table: PublicTableView; room: RoomView; perspective: number; youSeat: number | null }) {
  const positions = ["bottom", "right", "top", "left"] as const;
  return (
    <div className="board" data-testid="board">
      {[0, 1, 2, 3].map((i) => {
        const seat = (perspective + i) % 4;
        return <SeatArea key={seat} table={table} room={room} seat={seat} position={positions[i]} isYou={youSeat === seat} />;
      })}
      <div className="center">
        <div className="center-round">
          {WIND_CHAR[table.roundWind]?.split(" ")[1]} round · Hand {table.handNumber}
        </div>
        <div className="center-wall" data-testid="wall-count">
          <strong>{table.wallCount}</strong> tiles left
        </div>
        <div className="center-dora">
          <span>Dora indicator</span>
          <span className="dora-tiles">
            {table.doraIndicators.map((t) => (
              <Tile key={t} tile={t} size="sm" />
            ))}
          </span>
        </div>
        {table.riichiSticks > 0 && <div className="center-sticks">Riichi sticks: {table.riichiSticks}</div>}
        {table.claim && (
          <div className="center-claim">
            Claim window: <Tile tile={table.claim.tile} size="sm" /> from {seatName(table.claim.from)}
          </div>
        )}
        {table.phase === "discard" && <div className="center-turn">{seatName(table.turn)} to discard</div>}
      </div>
    </div>
  );
}
