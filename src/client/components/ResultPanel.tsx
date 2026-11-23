import type { ReactNode } from "react";
import type { PublicTableView } from "../../engine/views";
import type { RoomView } from "../../shared/protocol";
import { seatName } from "../../shared/protocol";
import { Tile } from "./Tile";

const YAKU_NAMES: Record<string, string> = {
  MenzenTsumo: "Fully concealed tsumo",
  Tanyao: "All simples",
  Pinfu: "Pinfu",
  Iipeikou: "Pure double sequence",
  SanshokuDoujun: "Mixed triple sequence",
  Ikkitsuukan: "Pure straight",
  Chiitoitsu: "Seven pairs",
  Toitoi: "All triplets",
  Honitsu: "Half flush",
  Chinitsu: "Full flush",
  Haku: "White dragon",
  Hatsu: "Green dragon",
  Chun: "Red dragon",
  Bakaze: "Round wind",
  Jikaze: "Seat wind",
};

export const yakuLabel = (n: string) => YAKU_NAMES[n] ?? n.replace(/([a-z])([A-Z])/g, "$1 $2");

export function ResultPanel({ table, room, children, isHost, onNext }: { table: PublicTableView; room: RoomView; children?: ReactNode; isHost: boolean; onNext: () => void }) {
  const r = table.result!;
  const name = (s: number) => {
    const o = room.seats[s];
    return `${seatName(s)} · ${o ? o.name : "empty"}`;
  };
  return (
    <section className="result" aria-label="Hand result" data-testid="result-panel">
      <h2 data-testid="result-title">{r.type === "win" ? `${name(r.winner)} wins by ${r.from === null ? "tsumo" : `ron off ${name(r.from)}`}` : "Exhaustive draw — nobody won"}</h2>
      {r.type === "win" ? (
        <div className="result-score">
          <div>
            <b>
              {r.han} han {r.fu} fu · {r.points.toLocaleString()} points
            </b>
          </div>
          <ul className="yaku-list">
            {r.yaku.map((y) => (
              <li key={y.name}>
                {yakuLabel(y.name)} <span className="muted">{y.han} han</span>
              </li>
            ))}
            {r.dora > 0 && (
              <li>
                Dora <span className="muted">{r.dora} han</span>
              </li>
            )}
          </ul>
          <div className="win-hand">
            {table.revealedHands?.[r.winner].map((t) => <Tile key={t} tile={t} size="sm" glow={t === r.winTile} />)}
            {table.seats[r.winner].melds.map((m, i) => (
              <span key={i} className="meld">
                {m.tiles.map((t) => (
                  <Tile key={t} tile={t} size="sm" />
                ))}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p>Tenpai at the end: {r.tenpai.length ? r.tenpai.map(name).join(", ") : "nobody"}.</p>
      )}
      <table className="deltas">
        <tbody>
          {r.deltas.map((d, s) => (
            <tr key={s}>
              <td>{name(s)}</td>
              <td className={d > 0 ? "pos" : d < 0 ? "neg" : ""}>{d > 0 ? `+${d}` : d}</td>
              <td className="muted">{table.seats[s].score.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
      {isHost ? (
        <button className="btn btn-primary" onClick={onNext} data-testid="btn-next-hand">
          Start next hand
        </button>
      ) : (
        <p className="muted">Waiting for the host to start the next hand. Spectators can claim an open or bot seat now.</p>
      )}
    </section>
  );
}
