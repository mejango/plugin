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
  await page.goto("http://localhost:3004/patchboard-angle?scene=classic");
  await page.waitForFunction(() => document.querySelector("canvas")?.__patchboard);
  assert.equal(await page.getByText("Drag a plug to unplug · release near a free socket to connect", { exact: true }).count(), 0, "full-screen variant has no bottom-left explainer");
  assert.equal(await page.getByRole("heading", {name:"PATCHBOARD",exact:true}).count(),0);
  assert.equal(await page.getByRole("button", {name:"Front",exact:true}).count(),0);
  const state = () => page.evaluate(() => document.querySelector("canvas").__patchboard());
  const aligned = s => {
    for (const c of s.cords) for (const [end, port] of c.ports.entries()) if (port !== null) {
      const plug = c.points[end === 0 ? 0 : c.points.length - 1].screen;
      const hole = s.sockets[port].hole;
      assert.ok(Math.hypot(plug.x - hole.x, plug.y - hole.y) < 0.1, "seated plug is centered on the visible hole");
      const collar=c.points[end===0?1:c.points.length-2],socket=s.sockets[port].position;
      assert.ok(Math.hypot(collar.x-socket.x,collar.y-socket.y,collar.z-socket.z-0.22)<1e-6,"a connected plug's housing must be fully aligned, not half-inserted");
    }
  };
  let s = await state(); aligned(s);
  assert.equal(s.sockets.length,s.layout.columns*s.layout.rows,"responsive socket grid covers the board");
  assert.ok(s.sockets[11].x - s.sockets[0].x > 1300, "socket grid fills desktop width");
  const target = s.sockets[1].hole;
  const scale = (s.sockets[1].x - s.sockets[0].x) / 1.05;
  const drag = async (x, y) => {
    const from = (await state()).cords[0].points[0].screen;
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 30 });
    await page.waitForFunction(({ x, y }) => {
      const p = document.querySelector("canvas").__patchboard().cords[0].points[0].screen;
      return Math.hypot(p.x - x, p.y - y) < 1;
    }, { x, y });
    await page.mouse.up();
  };
  await drag(target.x + 0.14 * scale, target.y);
  s = await state();
  assert.equal(s.cords[0].ports[0], null, "drop on the rim must not connect");
  assert.equal(s.docking.length, 0, "rim must not trigger alignment assist");
  await page.keyboard.press("r");
  await drag(target.x, target.y);
  await page.waitForFunction(() => document.querySelector("canvas").__patchboard().cords[0].ports[0] === 1);
  aligned(await state());
  await page.keyboard.press("o");
  await page.keyboard.press("f");
  aligned(await state());
  if (process.env.PATCHBOARD_SCREENSHOT) await page.screenshot({ path: process.env.PATCHBOARD_SCREENSHOT });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  s = await state(); aligned(s);
  assert.equal(s.layout.columns,4,"mobile uses four reachable columns");
  assert.ok(s.sockets[0].x > 0 && s.sockets[3].x < 390, "mobile keeps all columns reachable");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(200);
  s = await state();
  assert.ok(s.sockets[11].x - s.sockets[0].x > 1300, "desktop framing returns after resize");
  assert.deepEqual(errors, []);
  console.log("PASS: full-screen framing, exact plug/hole alignment, rim rejection, hole seating, camera reset and responsive resize");
} finally { await browser.close(); }
