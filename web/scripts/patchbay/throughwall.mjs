import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables; const far = G.pts[N - 1], mid = O.pts[7];
  // lay G straight from its far end across O's body at pts[7], 150px beyond, UNDER O
  const ax = Math.atan2(mid.y - far.y, mid.x - far.x), ux = Math.cos(ax), uy = Math.sin(ax), px = -uy, py = ux;
  const H0 = { x: mid.x + ux * 150, y: mid.y + uy * 150 };
  ev('pointerdown', G.pts[0].x, G.pts[0].y); await wait(30); ev('pointermove', H0.x, H0.y);
  for (let i = 0; i < N; i++) { const k = 1 - i / (N - 1); G.pts[i].x = far.x + (H0.x - far.x) * k; G.pts[i].y = far.y + (H0.y - far.y) * k; G.pts[i].z = 0; G.prev[i].x = G.pts[i].x; G.prev[i].y = G.pts[i].y; G.prev[i].z = 0; }
  s.stick.set("0,1", -1); await wait(200);
  const side = (q) => Math.sign((q.x - O.pts[6].x) * (O.pts[8].y - O.pts[6].y) - (q.y - O.pts[6].y) * (O.pts[8].x - O.pts[6].x));
  // now drag the hand SIDEWAYS along O's direction... no: drag it back across O's line, perpendicular, 400px
  const dir = Math.atan2(O.pts[8].y - O.pts[6].y, O.pts[8].x - O.pts[6].x); const nx = -Math.sin(dir), ny = Math.cos(dir);
  const sg = side(H0); // H0's side of O; push to the other side
  let H1 = { x: H0.x - nx * sg * 400, y: H0.y - ny * sg * 400 }; if (side(H1) === sg) H1 = { x: H0.x + nx * sg * 400, y: H0.y + ny * sg * 400 };
  const sideH1 = side(H1), sideFar = side(far);
  let crossedFrames = 0, firedAt = -1; const log = []; const before = { a: !!O.looseA, b: !!O.looseB };
  for (let k = 0; k <= 150; k++) { const u = Math.min(1, k / 100); ev('pointermove', H0.x + (H1.x - H0.x) * u, H0.y + (H1.y - H0.y) * u); await wait(16);
    if (firedAt < 0 && (O.looseA || O.looseB)) firedAt = k;
    const sd = (q, j) => Math.sign((q.x - O.pts[j].x) * (O.pts[j+1].y - O.pts[j].y) - (q.y - O.pts[j].y) * (O.pts[j+1].x - O.pts[j].x));
    const segHit = (p0, p1, q0, q1) => { const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y; const den = ux * vy - uy * vx; if (Math.abs(den) < 1e-12) return false; const wx = q0.x - p0.x, wy = q0.y - p0.y; const t = (wx * vy - wy * vx) / den, u = (wx * uy - wy * ux) / den; return t >= 0 && t < 1 && u >= 0 && u < 1; };
    let xs = 0; for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) if (segHit(G.pts[i], G.pts[i+1], O.pts[j], O.pts[j+1])) xs++;
    if (!window.__last) window.__last = G.pts.map(q => ({ x: q.x, y: q.y }));
    const crossers = []; for (let i = 0; i < 6; i++) for (let j = 0; j < N - 1; j++) if (segHit(window.__last[i], G.pts[i], O.pts[j], O.pts[j+1])) crossers.push([i, j]);
    window.__last = G.pts.map(q => ({ x: q.x, y: q.y }));
    if (crossers.length) log.push(['X', k, crossers, O.pts.slice(0, 16).map(q => [Math.round(q.x), Math.round(q.y)]).filter((q, j) => crossers.some(cr => Math.abs(cr[1] - j) <= 1))]);
    if (false) log.push([k, Math.round(G.pts[0].x), Math.round(G.pts[0].y), xs, c.__wallHits || 0, Math.round(G.pts[1].x), Math.round(G.pts[1].y), Math.round(G.pts[2].x), Math.round(G.pts[2].y)]);
    if (false) log.push([k, Math.round(G.pts[0].x), Math.round(G.pts[0].y), s.stick.get("0,1"), sd(G.pts[0], 0), sd(G.pts[1], 0), sd(G.pts[2], 0), Math.round(G.pts[1].z)]); }
  return { log, O0: [Math.round(O.pts[0].x), Math.round(O.pts[0].y)], O1: [Math.round(O.pts[1].x), Math.round(O.pts[1].y)], sideH0: sg, sideH1, sideFar, handEnd: [Math.round(G.pts[0].x), Math.round(G.pts[0].y)], before, firedAt, loose: [!!O.looseA, !!O.looseB], order: s.stick.get("0,1") };
});
console.log(JSON.stringify(out));
await pg.screenshot({ path: '/private/tmp/claude-501/-Users-jango-Documents-telligence/07cf486e-b041-4904-950a-aa42fd6cafd2/scratchpad/wall.png' });
await b.close();
