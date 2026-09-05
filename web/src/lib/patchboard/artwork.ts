import type { V3 } from "./math";

// Printed panel artwork, using the same multilingual signal vocabulary and
// circuit motifs as patchbay.ts. Uploaded once, not redrawn during simulation.
export function panelArtwork(sockets: V3[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048; canvas.height = 1536;
  const ctx = canvas.getContext("2d")!;
  const sx = canvas.width / 13, sy = canvas.height / 8.5;
  const point = (x: number, y: number) => [(x + 6.5) * sx, (8.5 - y) * sy] as const;
  const text = (label: string, x: number, y: number, size = 15, alpha = 0.5) => {
    ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(45,49,47,${alpha})`; ctx.textAlign = "center";
    ctx.fillText(label, ...point(x, y));
  };
  const line = (points: [number, number][], alpha = 0.2) => {
    ctx.strokeStyle = `rgba(45,49,47,${alpha})`; ctx.lineWidth = 1.4;
    ctx.beginPath(); points.forEach(([x, y], i) => { const p = point(x, y); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }); ctx.stroke();
  };
  const labels = [
    "SIGNAL IN", "信號入", "信号入力", "TÍN HIỆU VÀO", "신호 입력",
    "Σ IN", "⊕ MIX", "金庫", "TREASURY", "∿ OUT",
    "REV OUT", "收益出", "発行", "NUÔI MÁY", "발행",
    "⏚ GND", "MINT CLK", "餵入", "SURPLUS", "→ ◉",
    "CASH OUT", "引出し", "RÚT RA", "OMNI BUS", "WEIGHT CUT",
    "BASE CV", "OPERATOR", "DOUBLING", "GATE", "CURVE FREQ",
  ];
  const subs = ["−5V ~ +5V", "0V ~ +5V", "USD ~ ETH", "50Ω", "24H ~ 90D", "±∞", "半減"];
  const columns=sockets.filter(s=>s.y===sockets[0].y).length;
  sockets.forEach((s, i) => {
    text(labels[(i*7+Math.floor(i/columns)) % labels.length], s.x, s.y + 0.34, 14);
    if(i%3!==1)text(subs[i % subs.length], s.x, s.y - 0.36, 10, 0.36);
    if (i % 5 === 0 && i + columns < sockets.length) {
      const next = sockets[i + columns];
      line([[s.x + 0.3, s.y], [s.x + 0.45, s.y], [s.x + 0.45, next.y], [next.x + 0.3, next.y]]);
      line([[next.x + 0.35, next.y + 0.035], [next.x + 0.3, next.y], [next.x + 0.35, next.y - 0.035]]);
    }
  });
  const chains = [
    ["PITCH / DETECTOR", "ISSUANCE / OSC", "SPLIT / FILTER", "KEEP / MIXER", "CASH OUT / AMP"],
    ["FEED / IN", "DOUBLING / CLK", "曲線 / 整形", "TREASURY / SUM", "剰余 / 還流"],
    ["OMNI / BUS", "SUCKER / BRIDGE", "SURPLUS / RETURN", "EXT PAY / IN", "TOKEN / OUT"],
  ];
  for (const [row, chain] of chains.entries()) {
    const y = 5.875 - row * 2.1;
    for (const [col, label] of chain.entries()) {
      const x = -4.3 + col * 2.15;
      const [a, b] = label.split(" / ");
      const p = point(x - 0.36, y + 0.13);
      ctx.strokeStyle = "rgba(45,49,47,0.22)"; ctx.lineWidth = 1.2;
      ctx.strokeRect(p[0], p[1], 0.72 * sx, 0.26 * sy);
      text(a, x, y + 0.025, 10, 0.45); text(b, x, y - 0.07, 10, 0.45);
      if (col < chain.length - 1) {
        line([[x + 0.36, y], [x + 1.79, y]]);
        line([[x + 1.72, y + 0.04], [x + 1.79, y], [x + 1.72, y - 0.04]]);
      }
    }
  }
  for (let i = 0; i < sockets.length; i+=4) {
    const x = sockets[i].x+0.43, y = sockets[i].y+0.28;
    const waveform: [number, number][] = Array.from({ length: 25 }, (_, j) => [x - 0.12 + j * 0.01, y + (i % 3 ? (Math.sin(j * 0.5) >= 0 ? 0.04 : -0.04) : Math.sin(j * 0.5) * 0.04)]);
    line(waveform, 0.35);
  }
  return canvas;
}
