// Run with the app on :3004: node scripts/patchboard/floor-check.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium }=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try{
  for(const [width,height] of [[1440,1000],[390,844]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.goto(new URL("/?seed=41",process.env.PATCHBOARD_BASE_URL||"http://localhost:3004").href);
    await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard?.().sleeping);
    const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
    const initial=await state();
    const accessible=initial.cords.map((c,i)=>({i,ends:[c.points[0],c.points.at(-1)]})).filter(({i,ends})=>
      ends.every(end=>initial.cords.every((other,j)=>i===j||other.points.every(p=>Math.hypot(p.screen.x-end.screen.x,p.screen.y-end.screen.y)>25))));
    accessible.sort((a,b)=>Math.max(...a.ends.map(p=>p.y))-Math.max(...b.ends.map(p=>p.y)));
    assert.ok(accessible.length,"find a visible low cable without another cable covering its plugs");
    const cord=accessible[0].i,otherPorts=initial.cords.filter((_,i)=>i!==cord).map(c=>c.ports);
    const last=initial.cords[cord].points.length-1;
    for(const index of [0,last]){
      const s=await state(),tip=s.cords[cord].points[index].screen;
      await page.mouse.move(tip.x,tip.y);await page.mouse.down();
      await page.mouse.move(tip.x+25,tip.y+35,{steps:10});
      await page.mouse.wheel(0,-350);await page.waitForTimeout(150);
      const grip=(await state()).grip;
      assert.deepEqual(grip&&{cord:grip.cord,index:grip.index},{cord,index},`unplug fixture at ${width}×${height}`);
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping,null,{timeout:30000});
    const fallen=(await state()).cords[cord];
    assert.deepEqual(fallen.ports,[null,null]);
    // In a narrow front view the two loose plugs can overlap. Pick the visible
    // front connector first, then the other after the first has been seated.
    const first=fallen.points[1].screen.z<fallen.points[last-1].screen.z?0:1;
    for(const end of [first,1-first]){
      const s=await state(),c=s.cords[cord],index=end===0?0:last,elbow=c.points[end===0?1:last-1];
      assert.ok(c.points[index].y<0.3,"re-grab a plug lying on the floor");
      // Click the rubber elbow, not the metal tip. A dropped connector may
      // be sideways or screen-overlapping its own body here.
      await page.mouse.move(elbow.screen.x,elbow.screen.y);await page.mouse.down();
      const held=await state();
      assert.equal(held.grip?.cord,cord);assert.equal(held.grip?.index,index,"the whole connector must select its physical endpoint");
      const anchor=c.ports[1-end],at=c.points[index].screen;
      const socket=s.sockets.map((p,i)=>({...p,i})).filter(p=>!p.occupied&&p.position.y<1&&
        (anchor===null||Math.hypot(p.position.x-s.sockets[anchor].position.x,p.position.y-s.sockets[anchor].position.y)<c.length-0.5))
        .sort((a,b)=>Math.hypot(a.hole.x-at.x,a.hole.y-at.y)-Math.hypot(b.hole.x-at.x,b.hole.y-at.y))[0];
      assert.ok(socket,"a reachable free socket is available near the floor");
      await page.mouse.move(socket.hole.x,socket.hole.y,{steps:30});
      await page.waitForFunction(({cord,index,x,y})=>{
        const p=document.querySelector("canvas").__patchboard().cords[cord].points[index].screen;
        return Math.hypot(p.x-x,p.y-y)<1;
      },{cord,index,x:socket.hole.x,y:socket.hole.y});
      await page.mouse.up();
      await page.waitForFunction(({cord,end,port})=>document.querySelector("canvas").__patchboard().cords[cord].ports[end]===port,{cord,end,port:socket.i},{timeout:30000});
      const seated=await state(),tip=seated.cords[cord].points[index],collar=seated.cords[cord].points[end===0?1:last-1];
      assert.deepEqual({x:tip.x,y:tip.y,z:tip.z},socket.position);
      assert.deepEqual({x:collar.x,y:collar.y,z:collar.z},{...socket.position,z:socket.position.z+0.22});
      assert.deepEqual(seated.cords.filter((_,i)=>i!==cord).map(c=>c.ports),otherPorts,"other plugs stay attached");
      assert.ok(seated.penetration<0.004);
      await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping,null,{timeout:30000});
      console.log(`PASS: ${width}×${height}, floor end ${end}: elbow pickup, cursor tracking, flush reinsertion, other plugs preserved`);
    }
    assert.deepEqual(errors,[]);await page.close();
  }
}finally{await browser.close();}
