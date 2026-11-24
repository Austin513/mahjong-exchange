import type { ReactNode } from "react";
import { kindOf, rankOf, suitOf } from "../../engine/tiles";

const SUIT = [
  { name: "characters", cls: "man" },
  { name: "dots", cls: "pin" },
  { name: "bamboo", cls: "sou" },
];
const HONORS = [
  { char: "東", latin: "E", name: "East wind", cls: "wind" },
  { char: "南", latin: "S", name: "South wind", cls: "wind" },
  { char: "西", latin: "W", name: "West wind", cls: "wind" },
  { char: "北", latin: "N", name: "North wind", cls: "wind" },
  { char: "", latin: "Wh", name: "White dragon", cls: "haku" },
  { char: "發", latin: "G", name: "Green dragon", cls: "hatsu" },
  { char: "中", latin: "R", name: "Red dragon", cls: "chun" },
];
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function tileName(kind: number): string {
  if (kind >= 27) return HONORS[kind - 27].name;
  return `${rankOf(kind)} ${SUIT[suitOf(kind)].name}`;
}

export function shortLabel(kind: number): string {
  if (kind >= 27) return HONORS[kind - 27].latin;
  return `${rankOf(kind)}${"mps"[suitOf(kind)]}`;
}

// ---------- tile faces (viewBox 0 0 30 40) ----------

const BLUE = "#1f4c9e";
const GREEN = "#17784a";
const RED = "#c23a2b";
const INK = "#1b2333";
const SERIF = `"Noto Serif SC", "Songti SC", "SimSun", serif`;

type Dot = [x: number, y: number, r: number, color: string];

const PIN: Record<number, Dot[]> = {
  1: [[15, 20, 10, RED]],
  2: [[15, 11, 5.6, GREEN], [15, 29, 5.6, BLUE]],
  3: [[8, 9, 4.8, BLUE], [15, 20, 4.8, RED], [22, 31, 4.8, GREEN]],
  4: [[9, 11, 5, BLUE], [21, 11, 5, GREEN], [9, 29, 5, GREEN], [21, 29, 5, BLUE]],
  5: [[8.5, 9.5, 4.4, BLUE], [21.5, 9.5, 4.4, GREEN], [15, 20, 4.4, RED], [8.5, 30.5, 4.4, GREEN], [21.5, 30.5, 4.4, BLUE]],
  6: [[9.5, 8, 4.2, GREEN], [20.5, 8, 4.2, GREEN], [9.5, 21, 4.2, RED], [20.5, 21, 4.2, RED], [9.5, 32, 4.2, RED], [20.5, 32, 4.2, RED]],
  7: [[7, 6.5, 3.5, GREEN], [15, 10.5, 3.5, GREEN], [23, 14.5, 3.5, GREEN], [10, 24.5, 3.7, RED], [20, 24.5, 3.7, RED], [10, 33.5, 3.7, RED], [20, 33.5, 3.7, RED]],
  8: [6.5, 15.5, 24.5, 33.5].flatMap((y) => [[10, y, 3.9, BLUE] as Dot, [20, y, 3.9, BLUE] as Dot]),
  9: [9, 20, 31].flatMap((y, row) => [7.5, 15, 22.5].map((x) => [x, y, 3.6, row === 1 ? RED : row === 0 ? BLUE : GREEN] as Dot)),
};

type Stick = [x: number, y: number, h: number, color: string];
const SOU: Record<number, Stick[]> = {
  2: [[15, 11, 13, GREEN], [15, 29, 13, BLUE]],
  3: [[15, 11, 13, GREEN], [9, 29, 13, BLUE], [21, 29, 13, BLUE]],
  4: [[10, 11, 13, GREEN], [20, 11, 13, BLUE], [10, 29, 13, BLUE], [20, 29, 13, GREEN]],
  5: [[8, 11, 13, GREEN], [22, 11, 13, BLUE], [15, 20, 13, RED], [8, 29, 13, BLUE], [22, 29, 13, GREEN]],
  6: [7, 15, 23].flatMap((x) => [[x, 11, 13, GREEN] as Stick, [x, 29, 13, BLUE] as Stick]),
  7: [[15, 7, 10, RED], ...[7, 15, 23].flatMap((x) => [[x, 20.5, 10, GREEN] as Stick, [x, 32.5, 10, BLUE] as Stick])],
  8: [6, 12, 18, 24].flatMap((x) => [[x, 11, 13, GREEN] as Stick, [x, 29, 13, BLUE] as Stick]),
  9: [7.5, 20, 32.5].flatMap((y) => [7, 15, 23].map((x) => [x, y, 10, x === 15 ? RED : GREEN] as Stick)),
};

function Coin([x, y, r, c]: Dot, i: number) {
  return (
    <g key={i}>
      <circle cx={x} cy={y} r={r} fill={c} />
      <circle cx={x} cy={y} r={r * 0.68} fill="#fffdf6" />
      <circle cx={x} cy={y} r={r * 0.42} fill={c} />
      {r > 7 && <circle cx={x} cy={y} r={r * 0.2} fill="#fffdf6" />}
    </g>
  );
}

function Bamboo([x, y, h, c]: Stick, i: number) {
  const w = 4.2;
  return (
    <g key={i}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} fill={c} />
      <line x1={x - w / 2} x2={x + w / 2} y1={y} y2={y} stroke="#fffdf6" strokeWidth={0.9} />
      <line x1={x} x2={x} y1={y - h / 2 + 1.6} y2={y + h / 2 - 1.6} stroke="#fffdf6" strokeOpacity={0.45} strokeWidth={0.7} />
    </g>
  );
}

function Face({ k }: { k: number }): ReactNode {
  if (k >= 27) {
    const h = HONORS[k - 27];
    if (h.cls === "haku") return <rect x={6.5} y={7} width={17} height={26} rx={2.5} fill="none" stroke={BLUE} strokeWidth={2.2} />;
    const color = h.cls === "hatsu" ? GREEN : h.cls === "chun" ? RED : INK;
    return (
      <text x={15} y={21} textAnchor="middle" dominantBaseline="central" fontSize={21} fontWeight={700} fill={color} fontFamily={SERIF}>
        {h.char}
      </text>
    );
  }
  const rank = rankOf(k);
  const suit = suitOf(k);
  if (suit === 0) {
    return (
      <>
        <text x={15} y={12} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill={INK} fontFamily={SERIF}>
          {NUMERALS[rank - 1]}
        </text>
        <text x={15} y={28.5} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={700} fill={RED} fontFamily={SERIF}>
          萬
        </text>
      </>
    );
  }
  if (suit === 1) return <>{PIN[rank].map(Coin)}</>;
  if (rank === 1) {
    // 1 bamboo: a single tall stalk with a red crest.
    return (
      <>
        <rect x={12.6} y={9} width={4.8} height={26} rx={2.4} fill={GREEN} />
        {[16, 22, 28].map((y) => (
          <line key={y} x1={12.6} x2={17.4} y1={y} y2={y} stroke="#fffdf6" strokeWidth={0.9} />
        ))}
        <path d="M15 3.5 L19.5 9 L15 7.6 L10.5 9 Z" fill={RED} />
      </>
    );
  }
  return <>{SOU[rank].map(Bamboo)}</>;
}

// ---------- component ----------

interface TileProps {
  tile?: number;
  kind?: number;
  size?: "xs" | "sm" | "md" | "lg";
  back?: boolean;
  sideways?: boolean;
  selected?: boolean;
  dim?: boolean;
  glow?: boolean;
  riichi?: boolean;
  fresh?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}

export function Tile({ tile, kind, size = "md", back, sideways, selected, dim, glow, riichi, fresh, onClick, disabled, testId }: TileProps) {
  const k = kind ?? (tile !== undefined ? kindOf(tile) : 0);
  const classes = ["tile", `tile-${size}`];
  if (back) classes.push("tile-back");
  if (sideways || riichi) classes.push("tile-side");
  if (selected) classes.push("tile-selected");
  if (dim) classes.push("tile-dim");
  if (glow) classes.push("tile-glow");
  if (fresh) classes.push("tile-fresh");
  if (onClick) classes.push("tile-button");
  if (back) return <span className={classes.join(" ")} aria-label="hidden tile" />;

  classes.push(k >= 27 ? `tile-${HONORS[k - 27].cls}` : `tile-${SUIT[suitOf(k)].cls}`);
  const index = k < 27 && suitOf(k) === 0 ? String(rankOf(k)) : k >= 27 && k <= 30 ? HONORS[k - 27].latin : null;
  const face = (
    <>
      <svg className="tile-face" viewBox="0 0 30 40" aria-hidden="true" focusable="false">
        <Face k={k} />
      </svg>
      {index && <span className="tile-index">{index}</span>}
    </>
  );
  const label = tileName(k) + (riichi ? " (riichi declaration)" : "");
  if (onClick) {
    return (
      <button type="button" className={classes.join(" ")} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={selected} data-testid={testId} data-kind={k}>
        {face}
      </button>
    );
  }
  return (
    <span className={classes.join(" ")} aria-label={label} title={label} data-kind={k}>
      {face}
    </span>
  );
}
