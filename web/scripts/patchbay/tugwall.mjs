import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables; const far = G.pts[N - 1];
  let X = O.pts[0]; for (const q of O.pts) if (q.y > X.y) X = q;   // red's U bottom
  X = { x: X.x, y: X.y + 2 };
  const dF = Math.hypot(far.x - X.x, far.y - X.y), ux = (far.x - X.x) / dF, uy = (far.y - X.y) / dF;
  const rest = G.len * 0.97 - dF;
  const P = { x: X.x - ux * rest, y: X.y + uy * rest };   // mirror of far's direction across vertical → a V under the U bottom
  const L = dF + rest;
  const at = (u) => { const a = u * L; return a <= dF ? { x: far.x + (X.x - far.x) * a / dF, y: far.y + (X.y - far.y) * a / dF } : { x: X.x + (P.x - X.x) * (a - dF) / rest, y: X.y + (P.y - X.y) * (a - dF) / rest }; };
  ev('pointerdown', G.pts[0].x, G.pts[0].y); await wait(30); ev('pointermove', P.x, P.y);
  for (let i = 0; i < N; i++) { const q = at(1 - i / (N - 1)); G.pts[i].x = q.x; G.pts[i].y = q.y; G.pts[i].z = 0; G.prev[i].x = q.x; G.prev[i].y = q.y; G.prev[i].z = 0; }
  s.stick.set("0,1", -1);
  let firedAt = -1, maxTug = 0; const handTrail = [];
  const Q = { x: P.x + (P.x - X.x) / rest * 80, y: P.y + (P.y - X.y) / rest * 80 };
  for (let k = 0; k < 150; k++) { ev('pointermove', Q.x + (k % 2), Q.y); await wait(16); maxTug = Math.max(maxTug, O.tugA || 0, O.tugB || 0); if (k % 3 === 0) handTrail.push(Math.round(Math.hypot(G.pts[0].x - Q.x, G.pts[0].y - Q.y))); if (firedAt < 0 && (O.looseA || O.looseB)) firedAt = k; if (!s.stick.has("0,1")) s.stick.set("0,1", -1); }
  await wait(2500);
  return { handTrail, X, P: [Math.round(P.x), Math.round(P.y)], firedAt, maxTug, loose: [!!O.looseA, !!O.looseB], hand: [Math.round(G.pts[0].x), Math.round(G.pts[0].y)], order: s.stick.get("0,1") };
});
console.log(JSON.stringify(out));
await pg.screenshot({ path: '/private/tmp/claude-501/-Users-jango-Documents-telligence/07cf486e-b041-4904-950a-aa42fd6cafd2/scratchpad/tugwall.png' });
await b.close();
