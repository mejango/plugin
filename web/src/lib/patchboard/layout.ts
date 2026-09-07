import { clamp } from "./math";

export type SocketLayout = { columns: number; rows: number; top: number; gap: number; rowGap?: number };
export type ScreenLayout = SocketLayout & { width: number; height: number; foot: number; trim: number; cables: number };

// Keep useful, finger-sized sockets on phones instead of shrinking twelve
// columns into a miniature board. Reserve a chrome trim below the last row.
export function screenLayout(width: number, height: number): ScreenLayout {
  width=Math.max(1,width);height=Math.max(1,height);
  const columns=clamp(Math.floor(width/100),4,12),gap=1.05;
  const foot=Math.min(32,height*0.04),boardWidth=columns*gap;
  const boardHeight=(height-foot)*boardWidth/width;
  const trim=Math.min(0.45,boardHeight*0.12);
  const rows=clamp(Math.round((boardHeight-trim)/gap),2,32),rowGap=(boardHeight-trim)/rows;
  return { columns,rows,gap,rowGap,top:boardHeight-rowGap/2,width:boardWidth,height:boardHeight,foot,trim,cables:clamp(Math.round(columns*rows/6),6,18) };
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
