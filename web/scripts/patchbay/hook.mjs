import { chromium, executablePath } from './pw.mjs';
const b = await chromium.launch({ executablePath });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await pg.addInitScript(() => { window.__patchbaySeed = 704995189; });
await pg.goto('http://localhost:3004/lab3d'); await pg.waitForTimeout(1500);
const out = await pg.evaluate(async () => {
  const c = document.querySelector('canvas'); const s = c.__pb3d(); const N = s.N;
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const [G, O] = s.cables; const gi = 0, fi = N - 1, oi = 0;
  const far = G.pts[fi], t = O.pts[oi];
  const ax = Math.atan2(t.y - far.y, t.x - far.x), ux = Math.cos(ax), uy = Math.sin(ax), px = -uy, py = ux;
  const R = 40;
  const mk = (D) => ({ x: t.x - ux * D - px * 60, y: t.y - uy * D - py * 60 });
  const plen = (w) => { let L = 0; for (let i = 0; i < w.length - 1; i++) L += Math.hypot(w[i+1].x - w[i].x, w[i+1].y - w[i].y); return L; };
  let D = 60; while (D < 2000 && plen([ { x: far.x, y: far.y }, { x: t.x + px * R, y: t.y + py * R }, { x: t.x + ux * R, y: t.y + uy * R }, { x: t.x - px * R, y: t.y - py * R }, mk(D) ]) < G.len * 0.97) D += 2;
  const H = mk(D);
  const way = [ { x: far.x, y: far.y }, { x: t.x + px * R, y: t.y + py * R }, { x: t.x + ux * R, y: t.y + uy * R }, { x: t.x - px * R, y: t.y - py * R }, H ];
  // resample the polyline to N points
  const segs = []; let L = 0; for (let i = 0; i < way.length - 1; i++) { const d = Math.hypot(way[i+1].x - way[i].x, way[i+1].y - way[i].y); segs.push(d); L += d; }
  const at = (u) => { let a = u * L; for (let i = 0; i < segs.length; i++) { if (a <= segs[i] || i === segs.length - 1) { const k = Math.min(1, a / segs[i]); return { x: way[i].x + (way[i+1].x - way[i].x) * k, y: way[i].y + (way[i+1].y - way[i].y) * k }; } a -= segs[i]; } };
  ev('pointerdown', G.pts[gi].x, G.pts[gi].y); await wait(30);
  ev('pointermove', H.x, H.y);
  for (let i = 0; i < N; i++) { const q = at(1 - i / (N - 1)); G.pts[i].x = q.x; G.pts[i].y = q.y; G.pts[i].z = 2; G.prev[i].x = q.x; G.prev[i].y = q.y; G.prev[i].z = 2; }
  let maxTug = 0, fired = -1; const speeds = []; const handTrail = []; const dbg = [];
  const log = []; const Q = { x: H.x - ux * 250, y: H.y - uy * 250 };
  for (let k = 0; k < 120; k++) { ev('pointermove', Q.x + (k % 2), Q.y); await wait(16); maxTug = Math.max(maxTug, O.tugA || 0); if (k % 5 === 0) { const st = c.__pb3d(); dbg.push([k, st.catchAt ? (st.catchAt.post ? 'p' : 'c') : '-', O.tugA || 0, Math.round(Math.hypot(G.pts[0].x - Q.x, G.pts[0].y - Q.y))]); } if (fired < 0 && O.looseA) fired = k; if (k % 3 === 0) handTrail.push(Math.round(Math.hypot(G.pts[0].x - Q.x, G.pts[0].y - Q.y))); if (fired >= 0 && k - fired < 40) { speeds.push(Math.round(Math.hypot(O.pts[0].x - O.prev[0].x, O.pts[0].y - O.prev[0].y))); if (k - fired === 12) window.__shot = true; }
    let md = 1e9, mi = -1; for (let i = 2; i < N - 2; i++) { const d = Math.hypot(G.pts[i].x - t.x, G.pts[i].y - t.y); if (d < md) { md = d; mi = i; } }
    const q = G.pts[mi], hand = G.pts[0], fe = G.pts[N-1]; if (k % 10 === 0) log.push([k, Math.round(md), mi, Math.round(q.z), (() => { const arc=(a,b)=>{let L=0;for(let k=a;k<b;k++)L+=Math.hypot(G.pts[k+1].x-G.pts[k].x,G.pts[k+1].y-G.pts[k].y);return L;}; const st=(a,b)=>Math.hypot(G.pts[b].x-G.pts[a].x,G.pts[b].y-G.pts[a].y); return [Math.round(100*st(0,Math.max(0,mi-2))/arc(0,Math.max(0,mi-2))), Math.round(100*st(Math.min(N-1,mi+2),N-1)/arc(Math.min(N-1,mi+2),N-1))]; })(), Math.round(Math.hypot(hand.x - H.x, hand.y - H.y))]); }
  await wait(3500);
  const seatedEnd = O.pts[N - 1], loose = O.pts[0];
  const hangAfter = [Math.round(loose.x - seatedEnd.x), Math.round(loose.y - seatedEnd.y)];
  const maxSpeed = (async () => { let m = 0; for (let k = 0; k < 30; k++) { const v = Math.hypot(loose.x - O.prev[0].x, loose.y - O.prev[0].y); m = Math.max(m, v); await wait(16); } return m; })();
  // seat G somewhere, then grab the loose plug and reseat it
  const taken = (j) => s.cables.some(k => k.a === j || k.b === j || k.na === j || k.nb === j);
  const gj = s.jacks.filter(j => !taken(j) && Math.hypot(j.x - far.x, j.y - far.y) < G.len * 0.7).sort((p, q) => Math.hypot(p.x - H.x, p.y - H.y) - Math.hypot(q.x - H.x, q.y - H.y))[0];
  for (let k = 1; k <= 30; k++) { ev('pointermove', H.x + (gj.x - H.x) * k / 30, H.y + (gj.y - H.y) * k / 30); await wait(16); }
  ev('pointerup', gj.x, gj.y); await wait(500);
  const gSeated = !c.__pb3d().drag;
  ev('pointerdown', loose.x, loose.y); await wait(50);
  const grabbed = !!c.__pb3d().drag;
  const free = s.jacks.filter(j => !taken(j) && Math.hypot(j.x - seatedEnd.x, j.y - seatedEnd.y) < O.len * 0.6 && Math.hypot(j.x - seatedEnd.x, j.y - seatedEnd.y) > 150)[0];
  if (!free) return { handTrail, fired, loose: !!O.looseA, maxTug, hangAfter, gSeated, grabbed, noFreeJack: true };
  const sx = loose.x, sy = loose.y;
  for (let k = 1; k <= 30; k++) { ev('pointermove', sx + (free.x - sx) * k / 30, sy + (free.y - sy) * k / 30); await wait(16); }
  ev('pointerup', free.x, free.y); await wait(800);
  const reseated = O.a === free && !O.looseA;
  return { dbg, handTrail, speeds, hangAfter, gSeated, grabbed, reseated, L: Math.round(L), len: Math.round(G.len), maxTug, fired, loose: !!O.looseA, hangDx: Math.round(loose.x - seatedEnd.x), hangDy: Math.round(loose.y - seatedEnd.y), Olen: Math.round(O.len) };
});
console.log(JSON.stringify(out));
await pg.screenshot({ path: '/private/tmp/claude-501/-Users-jango-Documents-telligence/07cf486e-b041-4904-950a-aa42fd6cafd2/scratchpad/hook.png' });
await b.close();
