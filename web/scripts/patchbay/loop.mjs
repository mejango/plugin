import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N, dpr = s.dpr;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables;
  // O's end a is the plug we loop around. Build a path for G: far end -> around the plug -> out to the hand
  const J = { x: O.pts[0].x, y: O.pts[0].y };
  const far = G.pts[N - 1];
  const away = Math.atan2(J.y - far.y, J.x - far.x);              // approach direction
  const rest = G.len / (N - 1);
  const R = rest * 1.15;   // loop big enough that its segments are not shorter than the cord's rest length
  const pts = [{ x: far.x, y: far.y }];
  // in to the plug, once around it, then straight out perpendicular
  for (let k = 0; k <= 24; k++) { const a = away + Math.PI + k / 24 * 2 * Math.PI; pts.push({ x: J.x + Math.cos(a) * R, y: J.y + Math.sin(a) * R }); }
  const outA = away + Math.PI / 2;
  const H = { x: J.x + Math.cos(outA) * 260 * dpr, y: J.y + Math.sin(outA) * 260 * dpr };
  pts.push(H);
  const segs = []; let L = 0; for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y); segs.push(d); L += d; }
  const at = (u) => { let a = u * L; for (let i = 0; i < segs.length; i++) { if (a <= segs[i] || i === segs.length - 1) { const k = Math.min(1, a / (segs[i] || 1)); return { x: pts[i].x + (pts[i+1].x - pts[i].x) * k, y: pts[i].y + (pts[i+1].y - pts[i].y) * k }; } a -= segs[i]; } };
  ev('pointerdown', G.pts[0].x / dpr, G.pts[0].y / dpr); await wait(30); ev('pointermove', H.x / dpr, H.y / dpr);
  for (let i = 0; i < N; i++) { const q = at(1 - i / (N - 1)); G.pts[i].x = q.x; G.pts[i].y = q.y; G.pts[i].z = 0; G.prev[i].x = q.x; G.prev[i].y = q.y; G.prev[i].z = 0; }
  const wind = () => { let w = 0; for (let i = 0; i < N - 1; i++) { const a0 = Math.atan2(G.pts[i].y - J.y, G.pts[i].x - J.x); let d = Math.atan2(G.pts[i+1].y - J.y, G.pts[i+1].x - J.x) - a0; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; w += d; } return Math.abs(w); };
  const wPlaced = Math.round(wind() * 100) / 100;
  const trace = []; for (let k = 0; k < 12; k++) { await wait(16); trace.push([Math.round(wind()*100)/100, c.__wrapN]); }
  const w0 = Math.round(wind() * 100) / 100;
  // pull the hand steadily further out along the exit direction
  let fired = -1, minW = 99, maxTug = 0;
  for (let k = 0; k < 200; k++) {
    const d = 260 + Math.min(k, 60) * 3;
    ev('pointermove', (J.x + Math.cos(outA) * d * dpr) / dpr, (J.y + Math.sin(outA) * d * dpr) / dpr);
    await wait(16);
    maxTug = Math.max(maxTug, O.tugA || 0); if (!O.looseA) minW = Math.min(minW, wind());
    if (fired < 0 && O.looseA) fired = k;
  }
  return { trace, wPlaced, w0, minWindBeforePop: Math.round(minW * 100) / 100, fired, maxTug, loose: [!!O.looseA, !!O.looseB], len: Math.round(G.len), L: Math.round(L) };
});
console.log(JSON.stringify(out));
await pg.screenshot({ path: '/private/tmp/claude-501/-Users-jango-Documents-telligence/07cf486e-b041-4904-950a-aa42fd6cafd2/scratchpad/loop.png' });
await b.close();
