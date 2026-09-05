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
  await page.goto(process.env.PATCHBOARD_URL || "http://localhost:3004/patchboard-angle");
  await page.waitForFunction(() => document.querySelector("canvas")?.__patchboard);
  const state = () => page.evaluate(() => document.querySelector("canvas").__patchboard());
  const positions = s => s.cords.map(c => c.points.map(({ x, y, z }) => ({ x, y, z })));
  const rest = async () => {
    await page.waitForFunction(() => document.querySelector("canvas").__patchboard().sleeping, null, { timeout: 20000 });
    const before = positions(await state());
    await page.waitForTimeout(1200);
    assert.deepEqual(positions(await state()), before, "rest means exactly zero movement across display frames");
  };
  await rest();
  console.log("PASS: initial scene becomes exactly motionless");
  for (const preset of ["¼-inch cable", "Firm + fast settling"]) {
    await page.locator("details").evaluate(el => { el.open = true; });
    await page.getByLabel("Cable preset").selectOption(preset);
    await page.locator("details").evaluate(el => { el.open = false; });
    await page.locator("canvas").first().focus(); await page.keyboard.press("r");
    await rest();
    const s = await state(), tip = s.cords[0].points[0].screen;
    const untouched = positions(s).slice(1);
    await page.mouse.move(tip.x, tip.y); await page.mouse.down();
    await page.mouse.move(tip.x + 35, tip.y + 125, { steps: 20 });
    await page.waitForTimeout(400);
    assert.ok((await state()).grip, "grab wakes the selected cable");
    assert.deepEqual(positions(await state()).slice(1), untouched, "unrelated cords stay still during a drag");
    await page.mouse.up();
    assert.equal((await state()).grip, null);
    await rest();
    assert.ok((await state()).penetration < 0.004);
    console.log(`PASS: ${preset} drop settles completely, unrelated cords stay still`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
