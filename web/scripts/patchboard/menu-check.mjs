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
  await page.goto("http://localhost:3004/patchboard");
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  const panel=page.locator("details"),summary=panel.locator("summary"),content=panel.locator(":scope > div");
  if(!await panel.evaluate(el=>el.open))await summary.click();
  await page.getByLabel("Cable preset").selectOption("Firm + fast settling");
  for(const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]){
    await page.setViewportSize({width,height});
    const bounds=await panel.boundingBox(),body=await content.boundingBox();
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,"open menu stays within the viewport");
    assert.ok(body.width>=bounds.width-40,`menu body uses the panel width, not a narrow strip (${body.width}/${bounds.width}px)`);
    assert.ok((await page.getByRole("slider",{name:"Bending stiffness",exact:true}).boundingBox()).width>200,"sliders retain a readable tuning range");
    assert.ok(await content.evaluate(el=>el.scrollWidth<=el.clientWidth+1),"no horizontally clipped controls");
    await page.getByRole("button",{name:"Restore cable defaults",exact:true}).click({trial:true});
    assert.ok(await content.evaluate(el=>el.scrollTop>0),"bottom controls are reachable by scrolling the menu");
    await content.evaluate(el=>{el.scrollTop=0;});
    await page.getByLabel("Cable preset").selectOption("Firm + fast settling");
    if(process.env.PATCHBOARD_SCREENSHOT_DIR&&[1440,390].includes(width))await page.screenshot({path:`${process.env.PATCHBOARD_SCREENSHOT_DIR}/patchboard-menu-${width}.png`});
    await summary.click();await summary.focus();await page.keyboard.press("Enter");
    assert.ok(await panel.evaluate(el=>el.open),"the disclosure remains keyboard accessible");
    console.log(`PASS: ${width}×${height}, full-width controls, reachable scrolling, long preset and keyboard toggle`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
