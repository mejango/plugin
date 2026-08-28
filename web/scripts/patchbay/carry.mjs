import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const O = s.cables[1];
  // make end a loose by hand (same as unplug), let it hang
  O.a = O.na = { x: O.pts[0].x, y: O.pts[0].y }; O.looseA = true; O.prev[0].x = O.pts[0].x; O.prev[0].y = O.pts[0].y; await wait(3000);
  // grab the seated end b and carry it to the top of the screen, then hold
  const sb = O.pts[N - 1]; ev('pointerdown', sb.x, sb.y); await wait(30);
  const T = { x: sb.x, y: 40 };
  for (let k = 1; k <= 40; k++) { ev('pointermove', sb.x, sb.y + (T.y - sb.y) * k / 40); await wait(16); }
  const atTop = [Math.round(O.pts[N-1].x), Math.round(O.pts[N-1].y)];
  for (let k = 0; k < 90; k++) { ev('pointermove', T.x + (k % 2), T.y); await wait(16); }
  const held = [Math.round(O.pts[N-1].x), Math.round(O.pts[N-1].y)];
  return { target: T, atTop, held, loose: [Math.round(O.pts[0].x), Math.round(O.pts[0].y)] };
});
console.log(JSON.stringify(out));
await pg.screenshot({ path: '/private/tmp/claude-501/-Users-jango-Documents-telligence/07cf486e-b041-4904-950a-aa42fd6cafd2/scratchpad/carry.png' });
await b.close();
