import { displayMount, type ScreenLayout } from "./layout";
import type { MachineReadout } from "./readout";

// A small bitmap alphabet keeps the display crisp at the board texture's resolution.
const GLYPHS: Record<string, string> = {
  A:"7e1111117e",B:"7f49494936",C:"3e41414122",D:"7f4141221c",E:"7f49494941",F:"7f09090901",
  G:"3e41495132",H:"7f0808087f",I:"00417f4100",J:"2040413f01",K:"7f08142241",L:"7f40404040",
  M:"7f020c027f",N:"7f0408107f",O:"3e4141413e",P:"7f09090906",Q:"3e4151215e",R:"7f09192946",
  S:"2649494932",T:"01017f0101",U:"3f4040403f",V:"1f2040201f",W:"3f4038403f",X:"6314081463",
  Y:"0708700807",Z:"6151494543",0:"3e5149453e",1:"00427f4000",2:"4261514946",3:"2141454b31",
  4:"1814127f10",5:"2745454539",6:"3c4a494930",7:"0101710907",8:"3649494936",9:"064949291e",
  " ":"0000000000",".":"0060600000",",":"0040200000","-":"0808080808","/":"2010080402",
  ":":"0036360000","+":"08083e0808","'":"0005030000","#":"147f147f14","<":"0814224100",
  "$":"244a7f4a12",
  ">":"0041221408","?":"0201510906","—":"0808080808","%":"2313086462",
};
function pixels(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale=2, color="#dcecff", maxWidth=Infinity) {
  let label=text.toUpperCase();
  const max=Math.floor(maxWidth/(6*scale));
  if(label.length>max)label=label.slice(0,Math.max(0,max-2))+"..";
  ctx.fillStyle=color;
  for(const char of label){
    const glyph=GLYPHS[char]??GLYPHS["?"];
    for(let col=0;col<5;col++){
      const bits=parseInt(glyph.slice(col*2,col*2+2),16);
      for(let row=0;row<7;row++)if(bits&(1<<row))ctx.fillRect(x+col*scale,y+row*scale,scale,scale);
    }
    x+=6*scale;
  }
}

export function drawMachineTerminal(ctx: CanvasRenderingContext2D, layout: ScreenLayout, sx: number, sy: number, state: MachineReadout) {
  const mount=displayMount(layout);
  const x=(mount.left+layout.width/2)*sx,y=(layout.height-mount.top)*sy,w=mount.width*sx,h=mount.height*sy;
  ctx.save();
  // Flush black frame and a recessed glass display, both part of the panel texture.
  const rim=ctx.createLinearGradient(x,y,x+w,y+h);
  rim.addColorStop(0,"#616566");rim.addColorStop(0.035,"#161919");rim.addColorStop(0.92,"#080a0b");rim.addColorStop(1,"#777b7d");
  ctx.fillStyle=rim;ctx.fillRect(x,y,w,h);
  const pad=Math.min(w*.035,h*.08);
  ctx.fillStyle="#010305";ctx.fillRect(x+pad,y+pad,w-2*pad,h-2*pad);
  const lcd=document.createElement("canvas");lcd.width=480;lcd.height=200;
  const screen=lcd.getContext("2d")!;
  screen.fillStyle="#090e16";screen.fillRect(0,0,480,200);
  screen.fillStyle="#dcecff";screen.fillRect(8,8,464,23);
  pixels(screen,state.detail?state.detail.name:`${state.mode??"top"} PLUG INS`,14,12,2,"#090e16",450);
  if(state.detail){
    if(state.detailLoading||state.detailFailed)pixels(screen,state.detailFailed?"STATS UNAVAILABLE":"READING PROJECT...",10,80,2,"#dcecff",460);
    else state.detail.rows.forEach((row,i)=>{
      const y=43+i*25;
      pixels(screen,row.label,10,y,2,"#9fb7d2",180);
      pixels(screen,row.value,470-Math.min(row.value.length*12,264),y,2,"#dcecff",264);
    });
    screen.fillStyle="#536379";screen.fillRect(8,178,464,1);
    pixels(screen,"< BACK",10,184,2);
    const footer=state.detailFailed?"RETRY >":"VIEW >";
    pixels(screen,footer,470-footer.length*12,184,2);
  }else{
    screen.fillStyle="#213044";screen.fillRect(8,34,464,21);
    screen.fillStyle="#8098b3";screen.fillRect(8,55,464,1);
    pixels(screen,state.mode==="latest"?"WHEN":"TICKER",10,38,2,"#c4d8ee");pixels(screen,"NAME",106,38,2,"#c4d8ee");pixels(screen,state.mode==="latest"?"EVENT":"BALANCE",386,38,2,"#c4d8ee");
    state.machines?.slice(0,6).forEach((machine,i)=>{
      const y=61+i*19,selected=i===(state.selected??0);
      if(selected){screen.fillStyle="#36516b";screen.fillRect(8,y-2,464,19);}
      pixels(screen,machine.ticker,10,y,2,"#e0eeff",90);
      pixels(screen,machine.name,106,y,2,"#dcecff",160);
      pixels(screen,machine.balance,470-Math.min(machine.balance.length*12,192),y,2,"#dcecff",192);
    });
    if(!state.machines?.length)pixels(screen,state.failed?"SIGNAL UNAVAILABLE":state.machines?"NO PLUG INS":"READING MACHINES...",10,90,2,"#dcecff",460);
    screen.fillStyle="#536379";screen.fillRect(8,178,464,1);
    pixels(screen,state.failed?"RETRY >":"ALL CHAINS",10,184,2,"#dcecff");
    const count=`${state.totalCount==null?"—":state.totalCount.toLocaleString("en-US")} ${state.mode==="latest"?"EVENTS":"MACHINES"}`;
    pixels(screen,count,470-count.length*12,184,2,"#dcecff");
  }
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(lcd,x+pad*1.5,y+pad*1.5,w-pad*3,h-pad*3);
  ctx.imageSmoothingEnabled=true;
  const glass=ctx.createLinearGradient(x,y,x+w,y+h);
  glass.addColorStop(0,"rgba(255,255,255,.065)");glass.addColorStop(0.45,"rgba(255,255,255,0)");glass.addColorStop(1,"rgba(120,160,220,.035)");
  ctx.fillStyle=glass;ctx.fillRect(x+pad,y+pad,w-pad*2,h-pad*2);

  const kx=(mount.keyX+layout.width/2)*sx,ky=(layout.height-mount.keyY)*sy,size=mount.keySize*sx;

  ctx.shadowColor="rgba(12,25,29,.28)";ctx.shadowBlur=size*.045;ctx.shadowOffsetY=size*.035;
  ctx.fillStyle="#1d2022";ctx.fillRect(kx-size/2,ky-size/2,size,size);
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  const key=ctx.createLinearGradient(kx,ky-size/2,kx,ky+size/2);
  key.addColorStop(0,"#95ebf4");key.addColorStop(0.12,"#50cce0");key.addColorStop(1,"#2099b5");
  ctx.fillStyle=key;ctx.fillRect(kx-size/2+2,ky-size/2+2,size-4,size-6);
  ctx.strokeStyle="rgba(234,255,255,.7)";ctx.lineWidth=Math.max(1,size*.012);
  ctx.beginPath();ctx.moveTo(kx-size*.47,ky+size*.43);ctx.lineTo(kx-size*.47,ky-size*.47);ctx.lineTo(kx+size*.47,ky-size*.47);ctx.stroke();
  ctx.strokeStyle="rgba(8,55,70,.45)";ctx.lineWidth=size*.025;
  ctx.beginPath();ctx.moveTo(kx+size*.47,ky-size*.45);ctx.lineTo(kx+size*.47,ky+size*.45);ctx.lineTo(kx-size*.45,ky+size*.45);ctx.stroke();
  ctx.fillStyle="#c7f7ff";ctx.fillRect(kx-size*.32,ky-size*.32,size*.18,Math.max(1,size*.035));
  ctx.font=`600 ${size*.2}px ui-sans-serif, system-ui, sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="#153d4b";ctx.fillText("NEW",kx,ky+size*.08);
  ctx.fillStyle="#e1e3cf";ctx.font=`500 ${Math.max(8,size*.17)}px ui-sans-serif, system-ui, sans-serif`;ctx.fillText("PLUG IN",kx,ky-size*.72);
  const knobX=(mount.knobX+layout.width/2)*sx,knobY=(layout.height-mount.knobY)*sy,radius=mount.knobRadius*sx;
  ctx.strokeStyle="rgba(228,232,214,.65)";ctx.lineWidth=Math.max(0.8,sx*.008);
  for(let i=0;i<=10;i++){
    const a=(-225+i*27)*Math.PI/180;
    ctx.beginPath();ctx.moveTo(knobX+Math.cos(a)*radius*1.22,knobY+Math.sin(a)*radius*1.22);
    ctx.lineTo(knobX+Math.cos(a)*radius*1.38,knobY+Math.sin(a)*radius*1.38);ctx.stroke();
  }
  ctx.fillStyle="#e1e3cf";ctx.font=`500 ${Math.max(8,radius*.4)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText("VOLUME",knobX,y+Math.max(8,radius*.4)*0.6);
  if (!state.programming) {
  const mx=(mount.modeX+layout.width/2)*sx,my=(layout.height-mount.modeY)*sy;
  for(let i=0;i<4;i++){
    const a=(-135+i*90)*Math.PI/180;
    ctx.beginPath();ctx.moveTo(mx+Math.sin(a)*radius*1.22,my-Math.cos(a)*radius*1.22);
    ctx.lineTo(mx+Math.sin(a)*radius*1.38,my-Math.cos(a)*radius*1.38);ctx.stroke();
  }
  ctx.fillStyle="#e1e3cf";ctx.fillText("VIEW MODE",mx,my-radius*1.9);
  }

  ctx.restore();
}
