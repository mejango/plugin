import { chromium, executablePath } from './pw.mjs';
const SEED = Number(process.argv[2] || 22);
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
await pg.addInitScript((sd) => { window.__patchbaySeed = sd; }, SEED);
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N, dpr = s.dpr;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables;
  const clearBefore = !s.stick.has('0,1') && !O.looseA && !O.looseB;
  // fresh grab, clear of O: wrap right around O's end-a plug and pull hard
  const J = { x: O.pts[0].x, y: O.pts[0].y };
  ev('pointerdown', G.pts[0].x / dpr, G.pts[0].y / dpr); await wait(50);
  const grabbed = !!c.__pb3d().drag;
  const R = (G.len / (N - 1)) * 1.15;
  const P0 = { x: G.pts[0].x, y: G.pts[0].y };
  const away = Math.atan2(J.y - P0.y, J.x - P0.x);
  const path = [];
  for (let k = 0; k <= 40; k++) path.push({ x: P0.x + (J.x - P0.x - Math.cos(away) * R) * k / 40, y: P0.y + (J.y - P0.y - Math.sin(away) * R) * k / 40 });
  for (let k = 0; k <= 40; k++) { const a = away + Math.PI + k / 40 * 2 * Math.PI; path.push({ x: J.x + Math.cos(a) * R, y: J.y + Math.sin(a) * R }); }
  const outA = away + Math.PI / 2;
  for (let k = 0; k <= 80; k++) path.push({ x: J.x + Math.cos(outA) * (R + k * 6 * dpr), y: J.y + Math.sin(outA) * (R + k * 6 * dpr) });
  let poppedAt = -1, maxTug = 0, maxWind = 0;
  const wind = () => { let w = 0; for (let i = 0; i < N - 1; i++) { const a0 = Math.atan2(G.pts[i].y - J.y, G.pts[i].x - J.x); let d = Math.atan2(G.pts[i+1].y - J.y, G.pts[i+1].x - J.x) - a0; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; w += d; } return Math.abs(w); };
  for (let i = 0; i < path.length + 60; i++) {
    const q = path[Math.min(i, path.length - 1)];
    ev('pointermove', q.x / dpr, q.y / dpr); await wait(16);
    maxTug = Math.max(maxTug, O.tugA || 0, O.tugB || 0); maxWind = Math.max(maxWind, wind());
    if (poppedAt < 0 && (O.looseA || O.looseB)) poppedAt = i;
  }
  return { clearBefore, grabbed, poppedAt, maxTug, maxWind: Math.round(maxWind * 100) / 100, othersPlugsIntact: !O.looseA && !O.looseB };
});
console.log(JSON.stringify(out));
await b.close();
