import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error("Set PLAYWRIGHT_CORE");
const {chromium}=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>localStorage.setItem("patchboard-feel-v1",JSON.stringify({bend:0.95,settling:10,damping:4.5,cordFriction:1.15})));
  await page.goto("http://localhost:3004/patchboard");
  await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard);
  await page.getByRole("button",{name:"Front",exact:true}).click();
  const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await frame();let s=await state();
  const p=s.cords[1].points[0].screen,notch=s.sockets[18];
  await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.mouse.wheel(0,-250);await frame();
  await page.mouse.move(notch.x,notch.y,{steps:50});await frame();
  await page.mouse.wheel(0,250);await frame();await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().cords[1].ports[0]===18);
  s=await state();const yellow=s.cords[2].points.at(-1).screen;
  await page.mouse.move(yellow.x,yellow.y);await page.mouse.down();
  for(const [x,y]of [[notch.x+25,notch.y-20],[notch.x+5,notch.y-25],[notch.x-80,notch.y+15]]){
    await page.mouse.move(x,y,{steps:30});await frame();
  }
  const target={x:s.sockets[24].x,y:s.sockets[24].y-40};
  await page.mouse.move(target.x,target.y,{steps:60});await frame();
  s=await state();const end=s.cords[2].points.at(-1).screen;
  const lag=Math.hypot(end.x-target.x,end.y-target.y);
  if(process.env.PATCHBOARD_SCREENSHOT)await page.screenshot({path:process.env.PATCHBOARD_SCREENSHOT});
  console.log(JSON.stringify({lag,penetration:s.penetration,rejected:s.rejectedSteps,lastRejection:s.lastRejection,timing:s.timing}));
  assert.ok(lag<3,`plug stopped ${lag.toFixed(1)}px from the cursor`);
  assert.ok(s.penetration<0.004);
  assert.equal(s.cords[1].ports[0],18);
  console.log("PASS: pull yellow cable around the blue plug at B9 with slack remaining");
}finally{await browser.close();}
