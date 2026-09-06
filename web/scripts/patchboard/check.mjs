// Run with the app on :3004: node scripts/patchboard/check.mjs
// Set PLAYWRIGHT_CORE if playwright-core is installed somewhere else.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const root = [process.env.PLAYWRIGHT_CORE, `${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p => p && existsSync(`${p}/index.mjs`));
if (!root) throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium } = await import(pathToFileURL(`${root}/index.mjs`).href);
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const url=new URL(process.env.PATCHBOARD_URL || "http://localhost:3004/patchboard");
  const tuning=url.pathname==="/patchboard";
  if(!tuning)url.searchParams.set("scene","classic");
  await page.goto(url.href);
  if(tuning)await page.locator("details").evaluate(el => { el.open = true; });
  await page.waitForFunction(() => document.querySelector("canvas")?.__patchboard);
  const state = () => page.evaluate(() => document.querySelector("canvas").__patchboard());
  const waitSteps = async (count) => {
    const start = (await state()).steps;
    await page.waitForFunction(s => document.querySelector("canvas").__patchboard().steps >= s, start + count);
  };
  await waitSteps(240);
  let s = await state();
  assert.equal(s.finite, true);
  assert.ok(s.penetration < 0.004);
  assert.ok(s.stretch < 1.15);
  const a = s.cords[0].points[0].screen, target = s.sockets[1];
  await page.mouse.click(a.x, a.y);
  assert.equal((await state()).cords[0].ports[0], 0);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 35 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const heldAtSocket = (await state()).cords[0].points[0].screen;
  assert.ok(Math.hypot(heldAtSocket.x - target.x, heldAtSocket.y - target.y) < 1, "held plug must track the cursor without spring lag");
  await waitSteps(180);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("canvas").__patchboard().cords[0].ports[0] === 1);
  console.log("PASS: unplug and seat in a different socket");
  s = await state();
  const b = s.cords[0].points[0].screen;
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 120, { steps: 30 });
  await page.mouse.wheel(0, -300); await waitSteps(180);
  s = await state();
  assert.ok(s.cords[0].points[0].z > 0.8, JSON.stringify({grip:s.grip,point:s.cords[0].points[0],penetration:s.penetration,rejected:s.rejectedSteps,steps:s.steps}));
  assert.equal(s.cords[0].ports[0], null);
  assert.ok(s.penetration < 0.004);
  await page.mouse.move(b.x + 100, b.y + 135);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fastGrip = (await state()).cords[0].points[0].screen;
  assert.ok(Math.hypot(fastGrip.x - b.x - 100, fastGrip.y - b.y - 135) < 1, "fast grip movement must reach the cursor within a display frame");
  await page.mouse.up();
  // Adaptive collision subdivisions are not a duration; wait for the drop
  // itself, including any brief contact on another cord along the way.
  await page.waitForFunction(() => document.querySelector("canvas").__patchboard().cords[0].points[0].y < 0.2);
  s = await state();
  assert.ok(s.cords[0].points[0].y < 0.2);
  assert.ok(s.penetration < 0.004);
  assert.ok(s.finite);
  console.log("PASS: depth control and gravity drop to floor");
  const p = s.cords[1].points[36].screen;
  await page.mouse.move(p.x, p.y);await page.mouse.down();
  await page.mouse.move(p.x + 180, p.y + 100, { steps: 40 });await waitSteps(180);
  s = await state();assert.ok(s.grip);assert.equal(s.grip.cord, 1);
  assert.ok(s.penetration < 0.004);
  await page.keyboard.press("Escape");
  assert.equal((await state()).grip, null);await page.mouse.up();
  console.log("PASS: grab cord body, pull across cords, Escape drops");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("o");
  await waitSteps(10);
  await page.keyboard.press("f");
  await page.keyboard.press("r");
  await waitSteps(10);
  assert.deepEqual((await state()).cords.map(c => c.ports), [[0,2],[3,5],[7,9]]);
  if(tuning){
  assert.equal(await page.getByRole("slider").count(), 9);
  await page.getByRole("button", { name: "Try firm + fast settling" }).click();
  assert.equal((await state()).feel.bend, 5);
  assert.equal((await state()).feel.settling, 24);
  await page.getByLabel("Cable preset").selectOption("Heavy rubber");
  assert.equal((await state()).feel.cordFriction, 1.15);
  await page.getByRole("slider", { name: "Motion damping", exact: true }).focus();
  await page.keyboard.press("End");
  assert.equal((await state()).feel.damping, 8);
  await page.getByLabel("Rest-shape memory", { exact: true }).uncheck();
  assert.equal((await state()).feel.shapeMemory, false);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("canvas")?.__patchboard);
  await page.locator("details").evaluate(el => { el.open = true; });
  assert.equal((await state()).feel.damping, 8);
  assert.equal((await state()).feel.shapeMemory, false);
  assert.equal(await page.getByRole("slider", { name: "Gravity", exact: true }).count(), 0);
  assert.equal(await page.getByRole("checkbox", { name: "Gravity enabled", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Restore cable defaults" }).click();
  assert.deepEqual((await state()).feel,{bend:8,settling:30,damping:8,cordFriction:0.5,floorFriction:0.95,grip:0.35,stretch:0.01,plugWeight:3.75,socketResistance:0.38,shapeMemory:true,socketAssist:true});
  console.log("PASS: socket hold, live settings, presets, persistence and defaults");
  }else{
    assert.equal(await page.locator("details, main footer").count(),0);
    assert.equal((await state()).feel.bend,8);
    assert.equal((await state()).feel.settling,30);
  }
  if (process.env.PATCHBOARD_SCREENSHOT) {
    if(tuning)await page.getByRole("region", { name: "Stiffness & settling" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.PATCHBOARD_SCREENSHOT });
  }
  await page.setViewportSize({width:390,height:844});await waitSteps(10);
  assert.ok((await state()).finite);
  assert.deepEqual(errors, []);
  console.log("PASS: camera controls, reset, resize, no browser errors");
} finally { await browser.close(); }
