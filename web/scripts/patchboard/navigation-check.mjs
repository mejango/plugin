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
    await page.goto("http://localhost:3004/?seed=41",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
    const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
    const exposed=await page.evaluate(()=>{
      const state=document.querySelector("canvas").__patchboard();
      for(let cord=0;cord<state.cords.length;cord++)for(const end of [0,1]){
        const points=state.cords[cord].points,tip=points[end===0?0:points.length-1].screen;
        if(tip.x>20&&tip.x<innerWidth-40&&tip.y>80&&tip.y<innerHeight-100&&document.elementFromPoint(tip.x,tip.y)?.tagName==="CANVAS")return {cord,end,tip};
      }
      return null;
    });
    assert.ok(exposed,"an exposed plug can be edited before navigation");
    const {tip}=exposed;
    await page.mouse.move(tip.x,tip.y);await page.mouse.down();
    await page.mouse.move(tip.x+20,tip.y+55,{steps:15});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping);
    const before=await state();assert.equal(before.cords[exposed.cord].ports[exposed.end],null,"preserve a user-modified patch, not just an untouched seed");
    await page.evaluate(()=>{window.__keptBoard=document.querySelector("canvas");window.__keptReader=window.__keptBoard.__patchboard;});
    const same=async()=>{
      assert.ok(await page.evaluate(()=>document.querySelector("canvas")===window.__keptBoard&&window.__keptBoard.__patchboard===window.__keptReader),"same mounted canvas and renderer");
      const after=await state();assert.equal(after.seed,before.seed);assert.deepEqual(after.layout,before.layout);
      assert.deepEqual(after.cords,before.cords,"all existing cable positions and connections survive navigation");
    };
    await page.getByRole("link",{name:"Create a new machine",exact:true}).click();await page.waitForURL("**/create");
    await page.getByLabel("Machine's name",{exact:true}).fill("Same patchboard");await same();
    assert.ok(await page.evaluate(()=>document.querySelector("canvas").closest("[inert]")),"foreground form owns input");
    await page.getByRole("heading",{name:"Identity",exact:true}).click();await page.keyboard.press("r");await same();
    await page.getByRole("button",{name:/full form/i}).click();
    const scroller=page.locator('[class*="fullForm"]');
    await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.ok(await scroller.evaluate(el=>el.scrollTop>0),"new page scrolls independently above the board");await same();
    if(process.env.PATCHBOARD_SCREENSHOT_DIR){
      await scroller.evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:`${process.env.PATCHBOARD_SCREENSHOT_DIR}/patchboard-create-${width}.png`});
    }
    await page.getByRole("link",{name:"← Board",exact:true}).click();await page.waitForURL("http://localhost:3004/");await same();
    assert.equal(await page.evaluate(()=>document.querySelector("canvas").closest("[inert]")!==null),false);
    await page.goBack();await page.waitForURL("**/create");await same();
    assert.equal(await page.locator('#name').inputValue(),"Same patchboard","draft survives returning to the board");
    await page.goForward();await page.waitForURL("http://localhost:3004/");await same();
    assert.deepEqual(errors,[]);await page.close();
    console.log(`PASS: ${width}×${height}, Now, form scrolling, Back and browser history preserve the same modified patchboard`);
  }
  const direct=await browser.newPage();await direct.goto("http://localhost:3004/create?seed=42",{waitUntil:"domcontentloaded"});
  await direct.waitForFunction(()=>document.querySelector("canvas")?.__patchboard?.().sleeping);
  assert.ok(await direct.getByLabel("Machine's name",{exact:true}).isVisible());
  console.log("PASS: direct /create visits also have an already-placed board");
}finally{await browser.close();}
