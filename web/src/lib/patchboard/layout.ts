import { clamp, v } from "./math";

export type SocketLayout = { columns: number; rows: number; top: number; gap: number; rowGap?: number; displayColumns?: number };
export type ScreenLayout = SocketLayout & { width: number; height: number; foot: number; trim: number; cables: number };

// Keep useful, finger-sized sockets on phones instead of shrinking twelve
// columns into a miniature board. Reserve a chrome trim below the last row.
export function screenLayout(width: number, height: number): ScreenLayout {
  width=Math.max(1,width);height=Math.max(1,height);
  const columns=clamp(Math.floor(width/100),4,12),gap=1.05;
  const foot=Math.min(32,height*0.04),boardWidth=columns*gap;
  const boardHeight=(height-foot)*boardWidth/width;
  const trim=Math.min(0.53,boardHeight*0.14);
  const rows=clamp(Math.round((boardHeight-trim)/gap),2,32),rowGap=(boardHeight-trim)/rows;
  return { columns,rows,gap,rowGap,displayColumns:Math.min(4,columns-1),top:boardHeight-rowGap/2,width:boardWidth,height:boardHeight,foot,trim,cables:clamp(Math.round((columns*rows-2*(Math.min(4,columns-1)+1))/6),rows<=3?4:6,18) };
}

export function seededRandom(seed: number) {
  return () => {
    seed=(seed+0x6d2b79f5)|0;
    let n=Math.imul(seed^(seed>>>15),1|seed);
    n^=n+Math.imul(n^(n>>>7),61|n);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
}

// In scene units (5 cm each): three physical stock lengths, not three sag
// amounts that accidentally produce a different length for every socket pair.
export const CABLE_LENGTHS = [3.6,5.8,8.2] as const;
export const CABLE_COLORS = [
  [0.91,0.28,0.13], [0.17,0.49,0.70], [0.77,0.64,0.27],
  [0.23,0.61,0.52], [0.27,0.25,0.25], [0.63,0.31,0.52],
  [0.80,0.78,0.70], [0.41,0.35,0.61], [0.43,0.29,0.22],
];

/** Reserve two rows for the display and the neighboring knob/key column. */
export function socketPositions(layout: SocketLayout, reserveDisplay = true) {
  return Array.from({ length: layout.columns * layout.rows }, (_, i) => ({
    row: Math.floor(i / layout.columns), col: i % layout.columns,
  })).filter(({ row, col }) => !reserveDisplay || !layout.displayColumns ||
    !(row < 2 && col <= layout.displayColumns) && !(col === Math.min(layout.displayColumns + 1, layout.columns - 1) && (row === (layout.columns > layout.displayColumns + 1 ? 0 : 2) || row === (layout.columns > layout.displayColumns + 1 ? 1 : 3))))
    .map(({ row, col }) => v((col - (layout.columns - 1) / 2) * layout.gap, layout.top - row * (layout.rowGap ?? layout.gap), 0.3));
}

export function displayMount(layout: ScreenLayout) {
  const rowGap = layout.rowGap ?? layout.gap;
  const columns = layout.displayColumns ?? 4;
  const keySize = Math.min(0.68, rowGap * 0.72);
  return {
    left: -layout.width / 2 + layout.gap + 0.09,
    top: layout.height - 0.09,
    width: columns * layout.gap - 0.18,
    height: 2 * rowGap - 0.18,
    keyX: -layout.width / 2 + 0.5 * layout.gap,
    keyY: layout.height - 2 * rowGap + 0.09 + keySize / 2,
    keySize,
    knobX: -layout.width / 2 + 0.5 * layout.gap,
    knobY: layout.height - rowGap * 0.64,
    knobRadius: Math.min(0.28, rowGap * 0.28),
    modeX: -layout.width / 2 + (Math.min(columns + 1, layout.columns - 1) + 0.5) * layout.gap,
    navX: -layout.width / 2 + (Math.min(columns + 1, layout.columns - 1) + 0.5) * layout.gap,
    navY: layout.top - rowGap * (layout.columns > columns + 1 ? 1 : 3),
    navSize: Math.min(layout.gap * .9, rowGap * .85),
    modeY: layout.height - rowGap * (layout.columns > columns + 1 ? 0.64 : 2.64),
  };
}
