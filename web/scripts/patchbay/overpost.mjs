import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables; const far = G.pts[N - 1], t = O.pts[0];
  const run = async (order) => {
    const ax = Math.atan2(t.y - far.y, t.x - far.x), ux = Math.cos(ax), uy = Math.sin(ax);
    const H = { x: t.x + ux * 120, y: t.y + uy * 120 };
    ev('pointerdown', G.pts[0].x, G.pts[0].y); await wait(30);
    let minD = 1e9;
    for (let k = 0; k < 30; k++) {
      ev('pointermove', H.x + (k % 2), H.y);
      // keep re-laying the cord straight THROUGH the plug; whatever offPosts does to it shows up as displacement
      for (let i = 0; i < N; i++) { const kk = 1 - i / (N - 1); G.pts[i].x = far.x + (H.x - far.x) * kk; G.pts[i].y = far.y + (H.y - far.y) * kk; G.pts[i].z = 0; G.prev[i].x = G.pts[i].x; G.prev[i].y = G.pts[i].y; }
      s.stick.set("0,1", order); await wait(16);
      for (let i = 2; i < N - 2; i++) minD = Math.min(minD, Math.hypot(G.pts[i].x - t.x, G.pts[i].y - t.y));
    }
    ev('pointerup', H.x, H.y); await wait(200);
    return Math.round(minD);
  };
  const overD = await run(1); const underD = await run(-1);
  return { overD, underD, R: Math.round(15 + G.r) };
});
console.log(JSON.stringify(out));
await b.close();
