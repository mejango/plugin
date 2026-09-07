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
  const approved={bend:8,settling:30,damping:8,cordFriction:0.5,floorFriction:0.95,grip:0.35,stretch:0.01,plugWeight:3.75,shapeMemory:true,socketAssist:true};
  // Previous experiment preferences must not override the public homepage.
  await page.addInitScript(()=>localStorage.setItem("patchboard-feel-v1",JSON.stringify({bend:0.25,settling:2,damping:1.6,shapeMemory:false,socketAssist:false})));
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://localhost:3004/?scene=classic",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
  assert.deepEqual((await state()).feel,approved,"homepage uses the approved defaults regardless of saved experiment settings");
  for(const [width,height] of [[1440,1000],[390,844],[844,390]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(300);
    assert.equal(await page.locator("details, main footer, main [aria-live]").count(),0,"homepage has no tuning menu or diagnostic footer");
    const title=page.getByRole("heading",{name:"TOP",exact:true}),now=page.getByRole("link",{name:"Create a new machine",exact:true}),signIn=page.getByRole("button",{name:"Sign in",exact:true});
    assert.ok(await title.isVisible());assert.equal(await now.getAttribute("href"),"/create");
    await now.click({trial:true});await signIn.click({trial:true});
    const box=await title.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
    const terminal=await page.getByRole("region",{name:"Machine terminal"}).boundingBox();assert.ok(terminal.x>=0&&terminal.x+terminal.width<=width,"hardware fits the viewport");
    const before=(await state()).sockets.map(s=>s.hole);
    await page.mouse.move(width/2,height/3);await page.mouse.wheel(0,600);await page.waitForTimeout(100);
    await page.mouse.wheel(0,-900);await page.waitForTimeout(100);
    assert.deepEqual((await state()).sockets.map(s=>s.hole),before,"scrolling must never zoom the front-on board");
    console.log(`PASS: ${width}×${height}, homepage title/actions fit and scroll leaves framing unchanged`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>{
    const l=document.querySelector("canvas").__patchboard().layout;
    return l.columns===12&&Math.abs(l.height-8.47)<0.001;
  });
  await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping);
  const p=await page.evaluate(()=>{
    const state=document.querySelector("canvas").__patchboard();
    for(const cord of state.cords)for(const node of cord.points.slice(4,-4)){
      const p=node.screen;
      if(p.x>20&&p.x<1420&&p.y>80&&p.y<950&&document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS")return p;
    }
    return null;
  });
  assert.ok(p,"an exposed cable remains available to drag");
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y+25,{steps:10});
  assert.ok((await state()).grip);await page.keyboard.press("Escape");await page.mouse.up();
  if(process.env.PATCHBOARD_SCREENSHOT)await page.screenshot({path:process.env.PATCHBOARD_SCREENSHOT});
  await page.reload();await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  assert.deepEqual((await state()).feel,approved);
  await page.goto("http://localhost:3004/patchboard-angle?scene=classic",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  assert.equal(await page.locator("details, main footer").count(),0,"preview route matches the clean homepage");
  assert.deepEqual((await state()).feel,approved);
  assert.deepEqual(errors,[]);
  console.log("PASS: homepage and preview use approved defaults, omit diagnostics, preserve actions, and allow dragging outside the terminal");
}finally{await browser.close();}
