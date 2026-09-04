import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
const root = [process.env.PLAYWRIGHT_CORE, `${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p => p && existsSync(`${p}/index.mjs`));
if (!root) throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium } = await import(pathToFileURL(`${root}/index.mjs`).href);
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://localhost:3004/patchboard");
  await page.waitForFunction(() => document.querySelector("canvas")?.__patchboard);
  await page.waitForTimeout(500);
  const state = () => page.evaluate(() => document.querySelector("canvas").__patchboard());
  const initial = await state(), start = initial.cords[0].points[0].screen;
  await page.mouse.move(start.x, start.y);await page.mouse.down();
  await page.mouse.move(start.x - 20, start.y + 70, { steps: 20 });
  await page.mouse.wheel(0, -600);await page.waitForTimeout(300);
  const held = await state();
  if (held.cords[0].ports[0] !== null) throw new Error("Did not unplug the cord");
  const result = await page.evaluate(() => new Promise(resolve => {
    const canvas = document.querySelector("canvas"), first = canvas.__patchboard();
    const start = performance.now();let last = start;const frames = [];
    const next = () => {
      const now = performance.now(), s = canvas.__patchboard();
      frames.push({ ms: now - start, dt: now - last, y: s.cords[0].points[0].y, steps: s.steps, rejected: s.rejectedSteps, simTime: s.simulationTime, ...s.timing });
      last = now;
      if (s.cords[0].points[0].y < 0.2 || now - start > 2500) resolve({ initial: first.cords[0].points[0], frames, diagnostics: s });
      else requestAnimationFrame(next);
    };
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    requestAnimationFrame(next);
  }));
  const frames = result.frames;
  console.log(JSON.stringify({ height: result.initial.y, floorMs: frames.at(-1).y < 0.2 ? frames.at(-1).ms : null, medianFrameMs: frames.map(f => f.dt).sort((a,b) => a-b)[Math.floor(frames.length/2)], rejected: result.diagnostics.rejectedSteps, penetration: result.diagnostics.penetration, samples: frames.filter((_,i) => i % Math.max(1,Math.floor(frames.length/10)) === 0) }, null, 2));
} finally { await browser.close(); }
