import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium }=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://localhost:3004/patchboard-angle");
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
  const first=await state();
  await page.reload();await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  const second=await state();
  assert.notEqual(first.seed,second.seed,"refresh chooses a fresh random seed");
  assert.notDeepEqual(first.cords.map(c=>c.ports),second.cords.map(c=>c.ports),"refresh changes actual socket connections");
  const still=async()=>{
    await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping,null,{timeout:30000});
    const before=(await state()).cords;
    await page.waitForTimeout(500);
    assert.deepEqual((await state()).cords,before,"a populated board becomes exactly still");
  };
  for(const [width,height] of [[2048,1164],[1440,1000],[768,1024],[390,844],[320,844],[844,390],[2560,1080]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(500);
    const s=await state(),l=s.layout;
    assert.equal(s.sockets.length,l.columns*l.rows);
    const pitch=width/l.columns,rowPitch=(height-l.foot)/l.rows;
    const a=s.sockets[0].hole,b=s.sockets.at(-1).hole;
    assert.ok(Math.abs(a.x-pitch/2)<1,"first column reaches the left edge");
    assert.ok(Math.abs(b.x-(width-pitch/2))<1,"last column reaches the right edge");
    assert.ok(Math.abs(a.y-rowPitch/2)<1,"top row has only half-cell inset");
    assert.ok(Math.abs(b.y-(height-l.foot-rowPitch/2))<1,"bottom row fills down to the table foot");
    assert.ok(s.cords.length>=6,"many cables, even on smaller screens");
    assert.ok(new Set(s.cords.map(c=>c.length.toFixed(1))).size>=2);
    const ports=s.cords.flatMap(c=>c.ports);
    assert.equal(new Set(ports).size,ports.length,"no socket is occupied twice");
    assert.ok(s.finite&&s.penetration<0.004);
    if(width===2048||width===390){
      await still();
      if(process.env.PATCHBOARD_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PATCHBOARD_SCREENSHOT_DIR}/patchboard-${width}.png`});
    }
    console.log(`PASS: ${width}×${height}, ${l.columns}×${l.rows} sockets, ${s.cords.length} cables, ${l.foot.toFixed(0)}px foot`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto("http://localhost:3004/patchboard-angle?seed=41");
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);await still();
  const s=await state();
  const ends=s.cords.flatMap((c,cord)=>[0,c.points.length-1].map(index=>({cord,index,point:c.points[index],port:c.ports[index===0?0:1]})));
  const handle=ends.find(e=>e.point.screen.x<1100&&e.point.screen.y<850&&s.cords.every((c,ci)=>ci===e.cord||c.points.every(p=>Math.hypot(p.screen.x-e.point.screen.x,p.screen.y-e.point.screen.y)>35)));
  assert.ok(handle,"find a visually accessible plug in the populated scene");
  const tip=handle.point.screen,ports=s.cords.map(c=>c.ports);
  const pull=Math.max(41,(s.feel.socketResistance+0.05)*1440/s.layout.width);
  const target={x:tip.x+pull*0.5,y:tip.y+pull*0.87};
  await page.mouse.move(tip.x,tip.y);await page.mouse.down();
  await page.mouse.move(target.x,target.y,{steps:20});
  await page.waitForFunction(({cord,index,x,y})=>{
    const s=document.querySelector("canvas").__patchboard(),p=s.cords[cord].points[index].screen;
    return s.grip?.cord===cord&&s.grip.index===index&&Math.hypot(p.x-x,p.y-y)<1;
  },{cord:handle.cord,index:handle.index,...target});
  const held=await state();
  assert.deepEqual(held.cords.filter((_,i)=>i!==handle.cord).map(c=>c.ports),ports.filter((_,i)=>i!==handle.cord));
  await still();
  await page.mouse.move(tip.x,tip.y,{steps:20});
  await page.mouse.up();
  await page.waitForFunction(({cord,index,port})=>document.querySelector("canvas").__patchboard().cords[cord].ports[index===0?0:1]===port,handle);
  assert.ok((await state()).penetration<0.004);
  console.log("PASS: populated scene supports a direct grip, held rest, fixed neighboring plugs and full reinsertion");
  assert.deepEqual(errors,[]);
  console.log("PASS: refresh randomization, responsive resize, unique occupied sockets, stock lengths and exact rest");
}finally{await browser.close();}
