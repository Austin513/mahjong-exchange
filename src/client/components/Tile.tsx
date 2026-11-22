import { kindOf, rankOf, suitOf } from "../../engine/tiles";

const SUIT = [
  { char: "萬", name: "characters", cls: "man" },
  { char: "筒", name: "dots", cls: "pin" },
  { char: "索", name: "bamboo", cls: "sou" },
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

export function tileName(kind: number): string {
  if (kind >= 27) return HONORS[kind - 27].name;
  return `${rankOf(kind)} ${SUIT[suitOf(kind)].name}`;
}

export function shortLabel(kind: number): string {
  if (kind >= 27) return HONORS[kind - 27].latin;
  return `${rankOf(kind)}${"mps"[suitOf(kind)]}`;
}

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
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}

export function Tile({ tile, kind, size = "md", back, sideways, selected, dim, glow, riichi, onClick, disabled, testId }: TileProps) {
  const k = kind ?? (tile !== undefined ? kindOf(tile) : 0);
  const classes = ["tile", `tile-${size}`];
  if (back) classes.push("tile-back");
  if (sideways || riichi) classes.push("tile-side");
  if (selected) classes.push("tile-selected");
  if (dim) classes.push("tile-dim");
  if (glow) classes.push("tile-glow");
  if (onClick) classes.push("tile-button");
  if (back) return <span className={classes.join(" ")} aria-label="hidden tile" />;

  let face;
  if (k >= 27) {
    const h = HONORS[k - 27];
    classes.push(`tile-${h.cls}`);
    face = (
      <>
        <span className="tile-glyph">{h.char || <span className="haku-frame" />}</span>
        <span className="tile-latin">{h.latin}</span>
      </>
    );
  } else {
    const s = SUIT[suitOf(k)];
    classes.push(`tile-${s.cls}`);
    face = (
      <>
        <span className="tile-rank">{rankOf(k)}</span>
        <span className="tile-suit">{s.char}</span>
      </>
    );
  }
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
