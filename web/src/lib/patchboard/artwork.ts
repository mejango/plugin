import type { V3 } from "./math";
import { displayMount, socketPositions, type ScreenLayout } from "./layout";
import type { MachineReadout } from "./readout";
import { drawMachineTerminal } from "./terminal-artwork";

let metalTexture: HTMLCanvasElement | null = null;
function agedMetal(width: number, height: number) {
  if(metalTexture?.width===width&&metalTexture.height===height)return metalTexture;
  const plate=document.createElement("canvas");plate.width=width;plate.height=height;
  const ctx=plate.getContext("2d")!;
  const finish=ctx.createLinearGradient(0,0,width,height);
  for(const [stop,color] of [[0,"#b1b4a8"],[.18,"#999e93"],[.48,"#a7ab9e"],[.72,"#888f83"],[1,"#a2a798"]] as const)finish.addColorStop(stop,color);
  ctx.fillStyle=finish;ctx.fillRect(0,0,width,height);
  let seed=7429;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Brushing follows the sheet, so it stays still while the hardware moves.
  for(let y=0;y<height;y++){
    ctx.fillStyle=random()>.5?`rgba(234,234,211,${random()*.045})`:`rgba(12,20,17,${random()*.065})`;
    ctx.fillRect(0,y,width,1);
  }
  for(let i=0;i<220;i++){
    ctx.fillStyle=`rgba(223,221,191,${.02+random()*.055})`;
    ctx.fillRect(random()*width,random()*height,3+random()*width*.045,.5);
  }
  const patina=ctx.createRadialGradient(width*.48,height*.36,0,width*.5,height*.5,Math.max(width,height)*.68);
  patina.addColorStop(0,"rgba(0,0,0,0)");patina.addColorStop(.6,"rgba(18,25,19,.04)");patina.addColorStop(1,"rgba(10,16,12,.18)");
  ctx.fillStyle=patina;ctx.fillRect(0,0,width,height);
  metalTexture=plate;return plate;
}

const engravingCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();

function engravedMark(image: HTMLImageElement, source: number[], width: number, height: number) {
  let cache=engravingCache.get(image);
  if(!cache){cache=new Map();engravingCache.set(image,cache);}
  const w=Math.ceil(width),h=Math.ceil(height),key=[...source,w,h].join(":");
  const cached=cache.get(key);if(cached)return cached;
  const mask=document.createElement("canvas");mask.width=w+4;mask.height=h+4;
  const m=mask.getContext("2d")!;
  m.drawImage(image,source[0],source[1],source[2],source[3],2,2,w,h);
  const mark=document.createElement("canvas");mark.width=mask.width;mark.height=mask.height;
  const ink=mark.getContext("2d")!;
  // A bright lower lip catches the same light as the chrome around the cut.
  ink.drawImage(mask,0,1);ink.globalCompositeOperation="source-in";
  ink.fillStyle="#f8fbfc";ink.fillRect(0,0,mark.width,mark.height);
  ink.globalCompositeOperation="source-over";
  // Preserve the supplied bronze color and worn metal texture.
  ink.drawImage(mask,0,0);
  // Remove the shifted silhouette to isolate the inner upper edge.
  const edge=document.createElement("canvas");edge.width=mask.width;edge.height=mask.height;
  const e=edge.getContext("2d")!;e.drawImage(mask,0,0);
  e.globalCompositeOperation="destination-out";e.drawImage(mask,.35,1);
  e.globalCompositeOperation="source-in";e.fillStyle="#46575f";e.fillRect(0,0,edge.width,edge.height);
  ink.globalAlpha=.75;ink.drawImage(edge,0,0);
  cache.set(key,mark);return mark;
}

// Printed panel artwork, using the same multilingual signal vocabulary and
// circuit motifs as patchbay.ts. Uploaded once, not redrawn during simulation.
export function panelArtwork(sockets: V3[], width=13, height=8.5, trim=0, engravings?: HTMLImageElement, terminal?: { layout: ScreenLayout; state: MachineReadout }) {
  const canvas = document.createElement("canvas");
  const resolution=Math.min(160,2048/Math.max(width,height));
  canvas.width=Math.round(width*resolution);canvas.height=Math.round(height*resolution);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(agedMetal(canvas.width,canvas.height),0,0);
  const sx = canvas.width / width, sy = canvas.height / height;
  const point = (x: number, y: number) => [(x + width/2) * sx, (height - y) * sy] as const;
  const text = (label: string, x: number, y: number, size = 15, alpha = 0.8) => {
    ctx.font = `500 ${size*resolution/158}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(38,45,39,${alpha})`; ctx.textAlign = "center";
    ctx.fillText(label, ...point(x, y));
  };
  const line = (points: [number, number][], alpha = 0.23) => {
    ctx.strokeStyle = `rgba(38,45,39,${alpha})`; ctx.lineWidth = 1.4;
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
    ctx.rect((m.navX+width/2-gap/2)*sx,(height-m.navY-rowGap/2)*sy,gap*sx,rowGap*sy);
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
    if(i%3!==1)text(subs[i % subs.length], s.x, s.y - 0.36, 10, 0.6);
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
      text(a, x, y + 0.025, 10, 0.65); text(b, x, y - 0.07, 10, 0.65);
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
      const left=(Math.min(...sockets.map(p=>p.x))+width/2)*sx,right=(Math.max(...sockets.map(p=>p.x))+width/2)*sx,markWidth=Math.min(canvas.width*.36,bandHeight*4.6);
      // Recess the supplied silhouettes into the metal, with an inner shadow and lower lip.
      for(const [sourceX,sourceY,sourceWidth,sourceHeight,x] of [[140,163,1410,257,left],[106,540,1465,247,right-markWidth]] as const){
        const markHeight=markWidth*sourceHeight/sourceWidth,markY=top+(bandHeight-markHeight)/2;
        const mark=engravedMark(engravings,[sourceX,sourceY,sourceWidth,sourceHeight],markWidth,markHeight);
        ctx.drawImage(mark,x-2,markY-2);
      }
    }
  }
  if(terminal)drawMachineTerminal(ctx,terminal.layout,sx,sy,terminal.state);
  return canvas;
}
