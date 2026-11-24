import type { PublicTableView } from "../../engine/views";
import type { Meld } from "../../engine/types";
import type { RoomView } from "../../shared/protocol";
import { seatName } from "../../shared/protocol";
import { Tile } from "./Tile";
import { useCountdown } from "./useCountdown";

const WIND: Record<number, { char: string; name: string }> = {
  27: { char: "東", name: "East" },
  28: { char: "南", name: "South" },
  29: { char: "西", name: "West" },
  30: { char: "北", name: "North" },
};

const SEAT_COLORS = ["#f0b848", "#7c9bff", "#4cd4a0", "#ff7eb6"];

function occupantLabel(room: RoomView, seat: number): { name: string; tag: string; away: boolean; bot: boolean } {
  const o = room.seats[seat];
  if (!o) return { name: "Empty", tag: "", away: false, bot: false };
  if (o.kind === "bot") return { name: o.name, tag: o.bot === "smart" ? "table bot" : "random bot", away: false, bot: true };
  return { name: o.name, tag: o.connected ? "human" : "offline", away: o.away, bot: false };
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

type Position = "bottom" | "right" | "top" | "left";

interface SeatAreaProps {
  table: PublicTableView;
  room: RoomView;
  seat: number;
  position: Position;
  isYou: boolean;
}

function SeatArea({ table, room, seat, position, isYou }: SeatAreaProps) {
  const s = table.seats[seat];
  const occ = occupantLabel(room, seat);
  const acting = table.phase === "discard" && table.turn === seat;
  const deadline = room.deadlines[seat];
  const left = useCountdown(deadline, room.serverNow);
  const lastDiscard = table.claim && table.claim.from === seat;
  const wind = WIND[s.wind];
  return (
    <section
      className={`seat seat-${position} ${acting ? "seat-acting" : ""} ${isYou ? "seat-you" : ""}`}
      style={{ ["--seat-c" as string]: SEAT_COLORS[seat] }}
      aria-label={`${seatName(seat)} ${occ.name}`} data-testid={`seat-${seat}`}>
      <header className="seat-head">
        <span className="seat-avatar" aria-hidden="true">
          {"ABCD"[seat]}
        </span>
        <span className="seat-id">
          <span className="seat-name">
            {occ.name}
            {isYou && <span className="you-tag"> · you</span>}
          </span>
          <span className="seat-meta">
            <span className="seat-wind" title={`${wind.name} seat`}>
              {wind.char} {wind.name}
            </span>
            {table.dealer === seat && <span className="badge badge-dealer">Dealer</span>}
            <span className={`seat-tag ${occ.away ? "away" : ""}`}>{occ.away ? "away · autopilot" : occ.tag}</span>
          </span>
        </span>
        <span className="seat-end">
          {s.riichi && <span className="badge badge-riichi">Riichi</span>}
          {acting && <span className="turn-pill">{left !== null ? `${left}s` : "turn"}</span>}
          {!acting && left !== null && table.phase === "claim" && <span className="turn-pill claim">deciding {left}s</span>}
          <span className="seat-score">{s.score.toLocaleString()}</span>
        </span>
      </header>
      <div className="seat-body">
        {!isYou && (
          <div className="concealed" aria-label={`${s.handCount} concealed tiles`}>
            {table.revealedHands
              ? table.revealedHands[seat].map((t) => <Tile key={t} tile={t} size="xs" />)
              : Array.from({ length: Math.min(s.handCount, 14) }, (_, i) => <Tile key={i} back size="xs" />)}
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
          {s.discards.length === 0 && <span className="pond-empty">no discards</span>}
          {s.discards.map((d, i) => (
            <Tile key={d.tile} tile={d.tile} size="sm" riichi={d.riichi} dim={d.calledBy !== null} glow={!!lastDiscard && i === s.discards.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Board({ table, room, perspective, youSeat }: { table: PublicTableView; room: RoomView; perspective: number; youSeat: number | null }) {
  const positions: Position[] = ["bottom", "right", "top", "left"];
  const posOf = (seat: number) => positions[(seat - perspective + 4) % 4];
  const active = table.phase === "discard" ? posOf(table.turn) : table.claim ? posOf(table.claim.from) : null;
  const round = WIND[table.roundWind];
  return (
    <div className="board" data-testid="board">
      {[0, 1, 2, 3].map((i) => {
        const seat = (perspective + i) % 4;
        return <SeatArea key={seat} table={table} room={room} seat={seat} position={positions[i]} isYou={youSeat === seat} />;
      })}
      <div className="center">
        <div className={`dial ${active ? `dial-${active}` : ""} ${table.phase === "claim" ? "dial-claim" : ""}`} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => {
            const seat = (perspective + i) % 4;
            return (
              <span key={seat} className={`dial-wind dial-wind-${positions[i]}`}>
                {WIND[table.seats[seat].wind].char}
              </span>
            );
          })}
          <div className="dial-core" data-testid="wall-count">
            <strong>{table.wallCount}</strong>
            <span>tiles left</span>
          </div>
        </div>
        <div className="center-info">
          <div className="center-round">
            {round?.name} round · Hand {table.handNumber}
          </div>
          <div className="center-dora">
            <span className="center-label">Dora</span>
            <span className="dora-tiles">
              {table.doraIndicators.map((t) => (
                <Tile key={t} tile={t} size="sm" />
              ))}
            </span>
          </div>
          {table.riichiSticks > 0 && <div className="center-sticks">Riichi sticks · {table.riichiSticks}</div>}
          {table.claim ? (
            <div className="center-claim">
              <Tile tile={table.claim.tile} size="sm" /> from {seatName(table.claim.from)}, open to claims
            </div>
          ) : (
            table.phase === "discard" && <div className="center-turn">{seatName(table.turn)} to discard</div>
          )}
        </div>
      </div>
    </div>
  );
}
