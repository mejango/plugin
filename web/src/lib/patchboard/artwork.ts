import type { V3 } from "./math";
import { displayMount, socketPositions, type ScreenLayout } from "./layout";
import type { MachineReadout } from "./readout";
import { drawMachineTerminal } from "./terminal-artwork";

// Printed panel artwork, using the same multilingual signal vocabulary and
// circuit motifs as patchbay.ts. Uploaded once, not redrawn during simulation.
export function panelArtwork(sockets: V3[], width=13, height=8.5, trim=0, engravings?: HTMLImageElement, terminal?: { layout: ScreenLayout; state: MachineReadout }) {
  const canvas = document.createElement("canvas");
  const resolution=Math.min(160,2048/Math.max(width,height));
  canvas.width=Math.round(width*resolution);canvas.height=Math.round(height*resolution);
  const ctx = canvas.getContext("2d")!;
  const sx = canvas.width / width, sy = canvas.height / height;
  const point = (x: number, y: number) => [(x + width/2) * sx, (height - y) * sy] as const;
  const text = (label: string, x: number, y: number, size = 15, alpha = 0.5) => {
    ctx.font = `500 ${size*resolution/158}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(45,49,47,${alpha})`; ctx.textAlign = "center";
    ctx.fillText(label, ...point(x, y));
  };
  const line = (points: [number, number][], alpha = 0.2) => {
    ctx.strokeStyle = `rgba(45,49,47,${alpha})`; ctx.lineWidth = 1.4;
    ctx.beginPath(); points.forEach(([x, y], i) => { const p = point(x, y); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }); ctx.stroke();
  };
  const ports=terminal?new Set(socketPositions(terminal.layout).map(p=>`${p.x}:${p.y}`)):null;
  const reserved=(p:V3)=>ports!==null&&!ports.has(`${p.x}:${p.y}`);
  ctx.save();
  if(terminal){
    const m=displayMount(terminal.layout),gap=terminal.layout.gap,rowGap=terminal.layout.rowGap??gap;
    ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);
    ctx.rect(0,0,(terminal.layout.displayColumns!+1)*gap*sx,rowGap*2*sy);
    ctx.rect((m.modeX+width/2-gap/2)*sx,(height-m.modeY-rowGap*.64)*sy,gap*sx,rowGap*sy);
    ctx.clip("evenodd");
  }
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
    if(reserved(s))return;
    text(labels[(i*7+Math.floor(i/columns)) % labels.length], s.x, s.y + 0.34, 14);
    if(i%3!==1)text(subs[i % subs.length], s.x, s.y - 0.36, 10, 0.36);
    if (i % 5 === 0 && i + columns < sockets.length && !reserved(sockets[i+columns])) {
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
  for (let row=0;row<Math.floor(sockets.length/columns)-1;row+=2) {
    const chain=chains[(row/2)%chains.length];
    const y=(sockets[row*columns].y+sockets[(row+1)*columns].y)/2;
    for (let col=0;col<columns-1;col+=2) {
      if([sockets[row*columns+col],sockets[row*columns+col+1],sockets[(row+1)*columns+col],sockets[(row+1)*columns+col+1]].some(reserved))continue;
      const label=chain[(col/2)%chain.length];
      const x=(sockets[row*columns+col].x+sockets[row*columns+col+1].x)/2;
      const [a, b] = label.split(" / ");
      const p = point(x - 0.36, y + 0.13);
      ctx.strokeStyle = "rgba(45,49,47,0.22)"; ctx.lineWidth = 1.2;
      ctx.strokeRect(p[0], p[1], 0.72 * sx, 0.26 * sy);
      text(a, x, y + 0.025, 10, 0.45); text(b, x, y - 0.07, 10, 0.45);
      if (col < columns - 3) {
        const next=(sockets[row*columns+col+2].x+sockets[row*columns+col+3].x)/2-0.36;
        line([[x + 0.36, y], [next, y]]);
        line([[next-0.07, y + 0.04], [next, y], [next-0.07, y - 0.04]]);
      }
    }
  }
  for (let i = 0; i < sockets.length; i+=4) {
    if(reserved(sockets[i]))continue;
    const x = sockets[i].x+0.43, y = sockets[i].y+0.28;
    const waveform: [number, number][] = Array.from({ length: 25 }, (_, j) => [x - 0.12 + j * 0.01, y + (i % 3 ? (Math.sin(j * 0.5) >= 0 ? 0.04 : -0.04) : Math.sin(j * 0.5) * 0.04)]);
    line(waveform, 0.35);
  }
  ctx.restore();
  if(trim>0){
    const top=(height-trim)*sy, bandHeight=trim*sy;
    const chrome=ctx.createLinearGradient(0,top,0,canvas.height);
    for(const [stop,color] of [[0,"#929b9f"],[0.025,"#f4f7f8"],[0.12,"#d9dee1"],[0.4,"#e7ebed"],[0.72,"#d0d7db"],[0.95,"#bac3c8"],[1,"#8e989f"]] as const)chrome.addColorStop(stop,color);
    ctx.fillStyle=chrome;ctx.fillRect(0,top,canvas.width,bandHeight);
    // Fine horizontal brushing and a broad reflected highlight in the metal.
    ctx.fillStyle="rgba(255,255,255,.09)";
    for(let y=top+2;y<canvas.height;y+=2)ctx.fillRect(0,y,canvas.width,0.5);
    const reflection=ctx.createLinearGradient(0,0,canvas.width,0);
    reflection.addColorStop(0,"rgba(255,255,255,0)");reflection.addColorStop(0.32,"rgba(255,255,255,.24)");reflection.addColorStop(0.56,"rgba(255,255,255,0)");reflection.addColorStop(1,"rgba(70,83,95,.1)");
    ctx.fillStyle=reflection;ctx.fillRect(0,top,canvas.width,bandHeight);
    if(engravings?.complete&&engravings.naturalWidth){
      const inset=Math.max(18,canvas.width*.045),markWidth=Math.min(canvas.width*.36,bandHeight*4.6);
      // Render the supplied lettering as dark markings recessed into the trim.
      for(const [sourceX,sourceY,sourceWidth,sourceHeight,x] of [[120,105,1930,240,inset],[120,405,1930,240,canvas.width-inset-markWidth]] as const){
        const markHeight=markWidth*sourceHeight/sourceWidth,markY=top+(bandHeight-markHeight)/2;
        ctx.save();ctx.globalAlpha=0.9;
        ctx.drawImage(engravings,sourceX,sourceY,sourceWidth,sourceHeight,x,markY,markWidth,markHeight);
        ctx.restore();
      }
    }
  }
  if(terminal)drawMachineTerminal(ctx,terminal.layout,sx,sy,terminal.state);
  return canvas;
}
