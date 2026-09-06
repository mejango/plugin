import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium }=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try{
  const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
  // Start observing before hydration, not after waiting for the world to rest.
  await page.addInitScript(()=>{
    window.__startup={frames:0,still:true,sleeping:true,seed:null,placement:null};
    const tick=()=>{
      const s=document.querySelector("canvas")?.__patchboard?.(),probe=window.__startup;
      if(s){
        const placement=JSON.stringify(s.cords.map(c=>({ports:c.ports,points:c.points.map(({x,y,z})=>({x,y,z}))})));
        if(probe.placement===null){probe.placement=placement;probe.seed=s.seed;}
        else probe.still&&=placement===probe.placement;
        probe.sleeping&&=s.sleeping;probe.frames++;
      }
      if(probe.frames<45)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const check=async()=>{
    await page.waitForFunction(()=>window.__startup?.frames===45);
    const probe=await page.evaluate(()=>window.__startup);
    assert.ok(probe.sleeping,"already sleeping at the first observed frame");
    assert.ok(probe.still,"zero cable movement from hydration through the initial display frames");
    return probe;
  };
  for(const [width,height] of [[1440,1000],[390,844],[844,390]]){
    await page.setViewportSize({width,height});await page.goto("http://localhost:3004/");
    const first=await check();await page.reload();const second=await check();
    assert.notEqual(first.seed,second.seed);assert.notEqual(first.placement,second.placement);
    console.log(`PASS: ${width}×${height}, still from first frame, refresh creates a new already-still patch`);
  }
  await page.locator("canvas").first().focus();await page.keyboard.press("r");
  assert.ok(await page.evaluate(()=>document.querySelector("canvas").__patchboard().sleeping),"reset is immediately still too");
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
