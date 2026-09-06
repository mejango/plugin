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
  await page.goto("http://localhost:3004/?seed=41");
  // Sleeping now precedes the first paint. Let the initial geometry upload and
  // ResizeObserver camera update finish before measuring steady-state work.
  await page.waitForFunction(()=>{
    const s=document.querySelector("canvas")?.__patchboard?.();
    return s?.sleeping&&s.timing.frameMs>0&&s.timing.uploadedBytes===0&&s.timing.drawCalls===0;
  },null,{timeout:30000});
  const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
  const sample=count=>page.evaluate(count=>new Promise(resolve=>{
    const frames=[];
    const tick=()=>{frames.push(document.querySelector("canvas").__patchboardTiming());if(frames.length<count)requestAnimationFrame(tick);else resolve(frames);};
    requestAnimationFrame(tick);
  }),count);
  const idle=await sample(15);
  assert.ok(idle.every(f=>f.uploadedBytes===0&&f.drawCalls===0&&f.rebuiltCords.length===0),"resting scene performs no geometry uploads or WebGL redraws");
  const s=await state(),cord=s.cords[0],tip=cord.points[0].screen;
  const profiler=process.env.PATCHBOARD_PROFILE?await page.context().newCDPSession(page):null;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  const far=s.cords.flatMap((c,ci)=>ci!==0&&c.points.every(a=>cord.points.every(b=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>1))?[ci]:[]);
  assert.ok(far.length>2);
  const recording=sample(90);
  await page.mouse.move(tip.x,tip.y);await page.mouse.down();
  for(let i=1;i<=30;i++)await page.mouse.move(tip.x+8*i/30,tip.y+20*i/30);
  // Continue the small local drag without crossing distant cables.
  const pull=31;
  await page.mouse.move(tip.x+pull*0.4,tip.y+pull*0.92,{steps:5});
  const frames=await recording,held=await state();
  if(profiler){
    const {profile}=await profiler.send("Profiler.stop");
    const hits=new Map();
    for(const n of profile.nodes){const name=n.callFrame.functionName||"(anonymous)";hits.set(name,(hits.get(name)||0)+(n.hitCount||0));}
    console.log("CPU profile samples:",JSON.stringify([...hits].sort((a,b)=>b[1]-a[1]).slice(0,20)));
  }
  assert.equal(held.grip?.cord,0);
  const changed=s.cords.flatMap((c,ci)=>{
    const drift=Math.max(...c.points.map((p,i)=>Math.hypot(p.x-held.cords[ci].points[i].x,p.y-held.cords[ci].points[i].y,p.z-held.cords[ci].points[i].z)));
    return drift?[{cord:ci,drift,remote:far.includes(ci)}]:[];
  });
  if(process.env.PATCHBOARD_PROFILE)console.log(JSON.stringify({changed,rebuilt:[...new Set(frames.flatMap(f=>f.rebuiltCords))],grip:held.grip}));
  for(const ci of far){
    assert.ok(!changed.some(c=>c.cord===ci),`remote cord ${ci} must stay exactly still`);
    assert.ok(frames.every(f=>!f.rebuiltCords.includes(ci)),`remote cord ${ci} must not be rebuilt or reuploaded`);
  }
  const active=frames.filter(f=>f.rebuiltCords.length);
  assert.ok(active.length>0);assert.ok(Math.max(...active.map(f=>f.rebuiltCords.length))<s.cords.length/2);
  const p95=key=>[...active].sort((a,b)=>a[key]-b[key])[Math.floor((active.length-1)*0.95)][key].toFixed(2);
  console.log(`PASS: ${s.cords.length} cords; ${far.length} remote cords unchanged; at most ${Math.max(...active.map(f=>f.rebuiltCords.length))} rebuilt per drag frame`);
  console.log(`Measured active-frame p95: physics ${p95("physicsMs")}ms, rendering ${p95("renderMs")}ms, upload ${p95("uploadedBytes")} bytes (local software WebGL)`);
  await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping,null,{timeout:30000});
  assert.ok((await sample(10)).every(f=>f.uploadedBytes===0&&f.drawCalls===0));
  if(process.env.PATCHBOARD_SCREENSHOT)await page.screenshot({path:process.env.PATCHBOARD_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log("PASS: dropping settles back to zero redraws; light shadows and hero render without browser errors");
}finally{await browser.close();}
