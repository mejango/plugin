// Patch-bay scenario suite: drives /lab3d in headless Chromium and checks the
// physical rules Jango has set. Every scenario is framed the same way: the
// cords must be STILL (asleep, zero motion) before the action and still again
// after it. Needs the dev server on :3004 and a playwright-core somewhere on
// this machine (the app does not depend on one).
//   npm run test:patchbay            all scenarios
//   npm run test:patchbay -- tug     scenarios whose name contains "tug"
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const CANDIDATES = [process.env.PLAYWRIGHT_CORE, `${homedir()}/.claude/skills/gstack/node_modules/playwright-core`, "/private/tmp/jbm-local-center/node_modules/playwright-core"].filter(Boolean);
const pwDir = CANDIDATES.find((d) => existsSync(`${d}/index.mjs`) || existsSync(`${d}/index.js`));
if (!pwDir) { console.error("no playwright-core found; set PLAYWRIGHT_CORE=/path/to/playwright-core"); process.exit(2); }
const pw = await import(existsSync(`${pwDir}/index.mjs`) ? `${pwDir}/index.mjs` : `${pwDir}/index.js`);
const chromium = pw.chromium ?? pw.default.chromium;
const URL = "http://localhost:3004/lab3d";
const HI = { viewport: { width: 1470, height: 838 }, deviceScaleFactor: 2 };
const LO = { viewport: { width: 1200, height: 850 } };
const LO800 = { viewport: { width: 1200, height: 800 } };

// ── helpers that run in the page ──────────────────────────────────────────
const inPage = {
  state: () => { const s = document.querySelector("canvas").__pb3d(); return { dpr: s.dpr, N: s.N, cables: s.cables.map((k) => ({ a: [k.a.x / s.dpr, k.a.y / s.dpr], b: [k.b.x / s.dpr, k.b.y / s.dpr], len: k.len / s.dpr, asleep: !!k.asleep, looseA: !!k.looseA, looseB: !!k.looseB, pts: k.pts.map((q) => [q.x / s.dpr, q.y / s.dpr, q.z / s.dpr]), pressing: (k.pressing || []).length })), drag: s.drag ? s.drag.end : null, mouse: s.rec.frames.at(-1), order: [...s.crossOrder.entries()] }; },
  // max per-point motion over `frames` frames, in CSS px, plus sleep flags
  motion: (frames) => new Promise((res) => { const c = document.querySelector("canvas"); let n = 0, snap = null; const worst = []; const tick = () => { const s = c.__pb3d(); const cur = s.cables.map((k) => k.pts.map((q) => [q.x, q.y])); if (snap) for (let a = 0; a < cur.length; a++) for (let i = 0; i < cur[a].length; i++) worst[a] = Math.max(worst[a] || 0, Math.hypot(cur[a][i][0] - snap[a][i][0], cur[a][i][1] - snap[a][i][1])); snap = cur; if (++n > frames) res({ move: worst.map((v) => +(v / s.dpr).toFixed(2)), asleep: s.cables.map((k) => !!k.asleep) }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }),
  // worst (over z − under z) at any xy crossing between cables a and b over `frames`, given a over b
  crossingOrder: ([a, b, frames]) => new Promise((res) => { const c = document.querySelector("canvas"); let n = 0, worst = 1e9, seen = 0;
    const hit = (p0, p1, q0, q1) => { const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y; const den = ux * vy - uy * vx; if (Math.abs(den) < 1e-12) return null; const wx = q0.x - p0.x, wy = q0.y - p0.y; const t = (wx * vy - wy * vx) / den, u = (wx * uy - wy * ux) / den; if (t < 0 || t >= 1 || u < 0 || u >= 1) return null; return { t, u }; };
    const tick = () => { const s = c.__pb3d(); const A = s.cables[a], B = s.cables[b]; for (let i = 0; i < s.N - 1; i++) for (let j = 0; j < s.N - 1; j++) { const h = hit(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]); if (!h) continue; seen++; worst = Math.min(worst, A.pts[i].z + (A.pts[i + 1].z - A.pts[i].z) * h.t - (B.pts[j].z + (B.pts[j + 1].z - B.pts[j].z) * h.u)); } if (++n >= frames) res({ seen, worst: +worst.toFixed(2) }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }),
};

async function open(browser, opts, seed) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.addInitScript((s) => { window.__patchbaySeed = s; }, seed);
  for (let k = 0; k < 4; k++) { try { await page.goto(URL); break; } catch { await page.waitForTimeout(3000); } }
  await page.waitForTimeout(1500);
  const glide = async (x0, y0, x1, y1, n = 30) => { for (let i = 1; i <= n; i++) { await page.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await page.waitForTimeout(16); } };
  const state = () => page.evaluate(inPage.state);
  // every cord asleep and motionless, waiting up to 12s for it
  const still = async (label) => {
    let m;
    for (let k = 0; k < 24; k++) { m = await page.evaluate(inPage.motion, 20); if (m.asleep.every(Boolean) && m.move.every((v) => v === 0)) return; await page.waitForTimeout(500); }
    throw new Error(`${label}: cords not still: move ${JSON.stringify(m.move)} asleep ${JSON.stringify(m.asleep)}`);
  };
  return { page, ctx, glide, state, still, close: () => ctx.close() };
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
// replay a recording (R on /lab3d) frame by frame: `frames` from `offset`, with its down/up events; `watch(f)` runs every 12th frame from `from`
async function replay(t, rec, { from = 0, watch, every = 12 } = {}) {
  const events = new Map(rec.events.map((e) => [e[0], e]));
  const last = rec.events.at(-1)[0];
  const out = [];
  for (let f = rec.offset; f <= last; f++) {
    const [x, y] = rec.frames[f - rec.offset]; if (x > -1e8) await t.page.mouse.move(x, y);
    const ev = events.get(f); if (ev) { if (ev[1] === "down") await t.page.mouse.down(); else await t.page.mouse.up(); }
    if (watch && f >= from && f % every === 0) { const r = await watch(f); if (r) out.push([f, r]); }
    await t.page.waitForTimeout(16);
  }
  return out;
}
const REC = (seed) => JSON.parse(readFileSync(new globalThis.URL(`./rec/${seed}.json`, import.meta.url), "utf8"));
// how deep the dragged cord sits inside the other cord's posts (CSS px; positive = inside), and the tug state
const inPost = () => { const s = document.querySelector("canvas").__pb3d(); const d = s.drag; if (!d) return null; const c = d.cable, ci = s.cables.indexOf(c), o = s.cables[1 - ci];
  const posts = []; for (const [name, i0, i1] of [["a", 0, 2], ["b", s.N - 1, s.N - 3]]) { if (o[name === "a" ? "looseA" : "looseB"]) continue; const p0 = o.pts[i0], p1 = o.pts[i1]; const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, ux = (p1.x - p0.x) / l, uy = (p1.y - p0.y) / l; posts.push({ name, x0: p0.x - ux * 19 * s.dpr, y0: p0.y - uy * 19 * s.dpr, x1: p0.x + ux * 27 * s.dpr, y1: p0.y + uy * 27 * s.dpr, R: o.width * 1.2 + c.r }); }
  let worst = null; for (const q of posts) { const dx = q.x1 - q.x0, dy = q.y1 - q.y0, ll = dx * dx + dy * dy || 1; c.pts.forEach((pt, i) => { const tt = Math.max(0, Math.min(1, ((pt.x - q.x0) * dx + (pt.y - q.y0) * dy) / ll)); const dd = Math.hypot(pt.x - q.x0 - dx * tt, pt.y - q.y0 - dy * tt); const depth = (q.R - dd) / s.dpr; if (!worst || depth > worst.depth) worst = { post: q.name, i, depth: +depth.toFixed(0), z: +(pt.z / s.dpr).toFixed(0) }; }); }
  const sign = s.crossOrder.get("0:1");
  return { ci, end: d.end, dragUnder: sign === undefined ? null : ci === 0 ? sign < 0 : sign > 0, hook: c.hookKey, pressing: (c.pressing || []).map((q) => q.name), tug: [o.tuga || 0, o.tugb || 0], loose: [!!o.looseA, !!o.looseB], worst, hand: [Math.round(c.pts[d.end === "a" ? 0 : s.N - 1].x / s.dpr), Math.round(c.pts[d.end === "a" ? 0 : s.N - 1].y / s.dpr)], mouse: s.rec.frames.at(-1) }; };

// ── scenarios ──────────────────────────────────────────────────────────────
const scenarios = {
  // a dealt board settles and sleeps, and no plug sits in a hole a cord lies across
  "rest 1087838052 dpr2": [HI, 1087838052, async (t) => { const s = await t.state(); noPlugUnderCord(s); }],
  "rest 1228770398 dpr2": [HI, 1228770398, async (t) => { noPlugUnderCord(await t.state()); }],
  "rest 534842927 dpr2": [HI, 534842927, async (t) => { noPlugUnderCord(await t.state()); }],
  "rest 704995189": [LO, 704995189, async (t) => { noPlugUnderCord(await t.state()); }],

  // the cord beneath stays beneath when its end is picked up and moved
  "under stays under": [LO, 704995189, async (t) => {
    const s = await t.state(); ok(s.cables[1].a.join() === "1020,540", `deal changed: ${JSON.stringify(s.cables)}`);
    await t.page.mouse.move(1020, 540); await t.page.mouse.down();
    const w = t.page.evaluate(inPage.crossingOrder, [0, 1, 60]);
    await t.glide(1020, 540, 1000, 400, 20); await t.page.waitForTimeout(600);
    const r = await w; ok(r.seen > 0 && r.worst > 0, `black over red at every crossing: ${JSON.stringify(r)}`);
    await t.page.mouse.up();
  }],

  // the cord beneath, pulled taut round the plug of the cord over it, tugs it free
  "under tug pops the plug": [LO, 704995189, async (t) => {
    await t.page.mouse.move(1020, 540); await t.page.mouse.down();
    await t.glide(1020, 540, 1000, 400, 30); await t.glide(1000, 400, 700, 300, 40); await t.page.waitForTimeout(1700);
    const s = await t.state(); ok(s.cables[0].looseB, "black's plug did not pop");
    await t.page.mouse.up();
  }],

  // the cord over another slides across it and its plug, never caught, and the hand reaches the cursor
  "over cord never caught": [LO, 704995189, async (t) => {
    await t.page.mouse.move(900, 540); await t.page.mouse.down();
    const w = t.page.evaluate(() => new Promise((res) => { const c = document.querySelector("canvas"); let n = 0, pressed = 0; const tick = () => { const s = c.__pb3d(); if ((s.cables[0].pressing || []).length) pressed++; if (++n > 100) res(pressed); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
    await t.glide(900, 540, 1060, 500, 40); await t.page.waitForTimeout(700);
    const pressed = await w; const s = await t.state(); const hand = s.cables[0].pts[s.N - 1];
    ok(pressed === 0, `over cord pressed a post ${pressed} frames`);
    ok(Math.hypot(hand[0] - s.mouse[0], hand[1] - s.mouse[1]) < 20, `hand short of cursor: ${hand} vs ${s.mouse}`);
    await t.page.mouse.up();
  }],

  // let go clear of any hole, the plug drops; on the shelf the cord keeps most of its curl; it can be lifted off again
  "drop, curl on the shelf, lift off": [LO800, 704995189, async (t) => {
    let s = await t.state(); const i = s.cables.map((k, j) => [k.len, j]).sort((x, y) => y[0] - x[0])[0][1]; const a = s.cables[i].a;
    await t.page.mouse.move(a[0], a[1]); await t.page.mouse.down(); await t.glide(a[0], a[1], 960, 700, 60); await t.page.waitForTimeout(1500);
    const floor = 800 - 30; const span = (st) => { const xs = st.cables[i].pts.filter((q) => q[1] > floor).map((q) => q[0]); return xs.length ? Math.max(...xs) - Math.min(...xs) : 0; };
    const held = span(await t.state()); ok(held > 50, `cord not on the shelf while held (span ${held})`);
    await t.page.mouse.up(); await t.still("after drop");
    s = await t.state(); ok(s.cables[i].looseA, "dropped plug did not go loose");
    const rel = span(s); ok(rel < held * 1.6, `curl lost on the shelf: ${held} → ${rel}`);
    const tip = s.cables[i].pts[0];
    await t.page.mouse.move(tip[0], tip[1]); await t.page.mouse.down(); await t.glide(tip[0], tip[1], tip[0] - 100, tip[1] - 400, 50); await t.page.waitForTimeout(600);
    s = await t.state(); const hand = s.cables[i].pts[0];
    ok(Math.hypot(hand[0] - s.mouse[0], hand[1] - s.mouse[1]) < 20, `could not lift the pile: hand ${hand} vs ${s.mouse}`);
    ok(s.cables[i].pts.filter((q) => q[1] > floor).length === 0, "cord still on the shelf after lifting");
    await t.page.mouse.up();
  }],

  // a hanging plug is grabbed by its body, and seats back in its hole
  "grab a hanging plug by its body": [LO800, 704995189, async (t) => {
    let s = await t.state(); const i = s.cables.map((k, j) => [k.len, j]).sort((x, y) => y[0] - x[0])[0][1]; const a = s.cables[i].a;
    await t.page.mouse.move(a[0], a[1]); await t.page.mouse.down(); await t.glide(a[0], a[1], a[0] - 60, a[1] + 180, 30); await t.page.mouse.up(); await t.still("after drop");
    const ang = await t.page.evaluate((i) => document.querySelector("canvas").__pb3d().cables[i].anga, i);
    s = await t.state(); const tip = s.cables[i].pts[0]; const body = [tip[0] + Math.cos(ang) * 18, tip[1] + Math.sin(ang) * 18];
    await t.page.mouse.move(body[0], body[1]); await t.page.mouse.down(); await t.page.waitForTimeout(80);
    ok((await t.state()).drag === "a", "grab by the plug body did not attach");
    await t.glide(body[0], body[1], a[0] - 8, a[1] + 8, 50); await t.page.mouse.up(); await t.page.waitForTimeout(1200);
    s = await t.state(); ok(!s.cables[i].looseA && s.cables[i].a.join() === a.join(), `did not seat back in ${a}: ${JSON.stringify(s.cables[i].a)}`);
  }],

  // Jango's recording: reseat a plug one hole over, let go — the slack loop hangs to the shelf; no jitter after release, still within 3s
  "release settles without jitter (585591263)": [HI, 585591263, async (t) => {
    const path = [[899,184],[898,184],[895,184],[893,184],[890,184],[887,184],[884,184],[882,184],[880,184],[878,184],[876,185],[874,185],[871,186],[867,186],[865,187],[863,187],[861,188],[859,188],[857,189],[855,189],[853,189],[851,190],[849,190],[847,190],[844,190],[838,190],[830,187],[820,184],[813,181],[807,180],[803,179],[799,178],[795,178],[792,177],[790,177]];
    await t.page.mouse.move(899.5, 184.3); await t.page.mouse.down(); await t.page.waitForTimeout(50);
    ok((await t.state()).drag === "b", "did not grab the plug at (900,180)");
    for (const [x, y] of path) { await t.page.mouse.move(x, y); await t.page.waitForTimeout(16); }
    await t.page.waitForTimeout(500); await t.page.mouse.up(); await t.page.waitForTimeout(3000);
    const m = await t.page.evaluate(inPage.motion, 30);
    ok(m.move.every((v) => v < 0.5), `still moving 3s after release: ${JSON.stringify(m.move)}`);
    const s = await t.state(); ok(s.cables[0].b.join() === "780,180", `did not seat at (780,180): ${JSON.stringify(s.cables[0].b)}`);
  }],

  // Jango's recording: a settled cord with shape keeps it when its end is grabbed — only what the hand pulls moves
  "grab keeps the cord's shape (571798856)": [HI, 571798856, async (t) => {
    await t.page.mouse.move(1140.04, 298.39); await t.page.mouse.down();
    const r = await t.page.evaluate(() => new Promise((res) => { const c = document.querySelector("canvas"); const s0 = c.__pb3d(); const k = s0.drag && s0.drag.cable; if (!k) return res(null); const start = k.pts.map((q) => [q.x, q.y]); let n = 0; const tick = () => { if (++n >= 20) res({ moved: k.pts.map((q, i) => Math.hypot(q.x - start[i][0], q.y - start[i][1]) / s0.dpr) }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
    ok(r, "did not grab the plug at (1140,298)");
    // the hand is still, so past the first few points nothing should move more than a few px
    const far = r.moved.slice(6); const worst = Math.max(...far);
    ok(worst < 6, `cord lost its shape on grab: max move away from the hand ${worst.toFixed(0)}px`);
    await t.page.mouse.up();
  }],

  // Jango's recording: an under cord pulled through the over cord's insert must tug that plug out, not tunnel through it
  "under cord pulled through an insert pops it (1469014391)": [HI, 1469014391, async (t) => {
    const rec = REC(1469014391);
    const log = await replay(t, rec, { from: 631, watch: () => t.page.evaluate(inPost) });
    await t.page.waitForTimeout(1500);
    const s = await t.state();
    const deepest = Math.max(...log.map(([, r]) => (r.worst && r.worst.z < 22 ? r.worst.depth : -99)));
    const popped = s.cables.some((k) => k.looseA || k.looseB);
    if (process.env.PB_VERBOSE) console.log(JSON.stringify(log.map(([f, r]) => [f, r.dragUnder, r.hook, r.pressing, r.tug, r.worst, r.hand])));
    ok(deepest < 6, `dragged cord sank ${deepest}px into the other cord's post`);
    ok(popped, "the over cord's plug did not pop");
  }],

  // Jango's recording: an under cord dragged against the over cord's insert must catch and pop it, not tunnel
  "under cord against an insert pops it (1596066957)": [HI, 1596066957, async (t) => {
    const rec = REC(1596066957);
    const log = await replay(t, rec, { from: 93, watch: () => t.page.evaluate(inPost) });
    await t.page.waitForTimeout(1500);
    const s = await t.state();
    const deepest = Math.max(...log.map(([, r]) => (r.worst && r.worst.z < 22 ? r.worst.depth : -99)));
    const popped = s.cables.some((k) => k.looseA || k.looseB);
    if (process.env.PB_VERBOSE) console.log(JSON.stringify(log.map(([f, r]) => [f, r.dragUnder, r.hook, r.pressing, r.tug, r.worst, r.hand])), `hand off the cursor: ${log.map(([f, r]) => f + ":" + Math.hypot(r.hand[0] - r.mouse[0], r.hand[1] - r.mouse[1]).toFixed(0)).join(" ")}`);
    ok(deepest < 6, `dragged cord sank ${deepest}px into the other cord's post`);
    ok(popped, "the over cord's plug did not pop");
  }],

  // Jango's recording: two separate cords — the one carried across the other's plug goes OVER it, never catches
  "carried cord rides over an unrelated plug (1870313391)": [HI, 1870313391, async (t) => {
    const rec = REC(1870313391);
    const before = await t.state();
    const log = await replay(t, rec, { from: 100, watch: () => t.page.evaluate(inPost) });
    await t.still("after replay");
    const s = await t.state();
    if (process.env.PB_VERBOSE) console.log(JSON.stringify(log.map(([f, r]) => [f, r.dragUnder, r.hook, r.pressing, r.tug, r.worst, r.hand, r.mouse])));
    const off = Math.max(...log.map(([, r]) => Math.hypot(r.hand[0] - r.mouse[0], r.hand[1] - r.mouse[1])));
    ok(off < 12, `hand held back from the cursor by ${off.toFixed(0)}px: the cord caught on the other plug`);
    ok(Math.max(...log.map(([, r]) => Math.max(...r.tug))) === 0, "the other cord's plug was strained");
    ok(!s.cables.some((k) => k.looseA || k.looseB), "a plug popped");
  }],

  // Jango's recording: a cord whose lower part lies on the shelf is dragged about by its upper plug — the
  // shelf part must slide along, not stick (the cord stretched against its own pins)
  "shelf section slides when the cord is dragged (1927592017)": [HI, 1927592017, async (t) => {
    const rec = REC(1927592017);
    const probe = () => { const s = document.querySelector("canvas").__pb3d(); const d = s.drag; if (!d) return null; const c = d.cable; let arc = 0; for (let i = 0; i < s.N - 1; i++) arc += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y, c.pts[i + 1].z - c.pts[i].z);
      const shelf = c.pts.filter((q) => q.y >= s.dpr * (838 - 40)); return { pins: Array.from(c.stuck || []).filter(Boolean).length, shelf: shelf.length, sx: shelf.length ? Math.round(Math.min(...shelf.map((q) => q.x)) / s.dpr) : null, stretch: +(arc / c.len).toFixed(3), hand: [Math.round(c.pts[d.end === "a" ? 0 : s.N - 1].x / s.dpr), Math.round(c.pts[d.end === "a" ? 0 : s.N - 1].y / s.dpr)], mouse: s.rec.frames.at(-1) }; };
    const log = await replay(t, rec, { from: 70, watch: () => t.page.evaluate(probe) });
    await t.still("after replay");
    if (process.env.PB_VERBOSE) console.log(log.map(([f, r]) => `${f}: pins ${r.pins} shelf ${r.shelf}@${r.sx} stretch ${r.stretch} hand ${r.hand} mouse ${r.mouse}`).join("\n"));
    const worst = Math.max(...log.map(([, r]) => r.stretch));
    ok(worst < 1.02, `cord stretched ${((worst - 1) * 100).toFixed(1)}% against its shelf pins while carried`);
  }],

  // Jango's recording: the top cord must not be drawn underneath the moment both cords fall asleep
  "over cord stays over after both sleep (667126059)": [HI, 667126059, async (t) => {
    await replay(t, REC(667126059)); await t.still("after replay");
    const r = await t.page.evaluate(() => { const s = document.querySelector("canvas").__pb3d(); const A = s.cables[0], B = s.cables[1];
      const hit = (p0, p1, q0, q1) => { const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y; const den = ux * vy - uy * vx; if (Math.abs(den) < 1e-12) return null; const wx = q0.x - p0.x, wy = q0.y - p0.y; const t = (wx * vy - wy * vx) / den, u = (wx * uy - wy * ux) / den; if (t < 0 || t >= 1 || u < 0 || u >= 1) return null; return { t, u }; };
      let dz = null; for (let i = 0; i < s.N - 1; i++) for (let j = 0; j < s.N - 1; j++) { const h = hit(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]); if (h) dz = (A.pts[i].z + (A.pts[i + 1].z - A.pts[i].z) * h.t) - (B.pts[j].z + (B.pts[j + 1].z - B.pts[j].z) * h.u); }
      return { dz, order: s.crossOrder.get("0:1") ?? null, asleep: s.cables.map((k) => !!k.asleep) }; });
    ok(r.dz !== null, "the cords no longer cross; scenario needs a crossing");
    ok(r.order !== null, "the crossing pair's order was pruned (draw order would flip)");
    ok(Math.sign(r.dz) === r.order, `drawn order ${r.order} disagrees with heights (dz ${r.dz.toFixed(1)})`);
  }],

  // a cord whose other end is loose drags freely: the loose end follows, the hand reaches the cursor
  "free drag with the other end loose": [LO, 704995189, async (t) => {
    const s = await t.state(); const c = s.cables[1]; ok(c.a.join() === "1020,540", `deal changed: ${JSON.stringify(s.cables)}`);
    // drop end a mid-board so it goes loose, then take end b far across the board — well past the cord's length from where a lies
    await t.page.mouse.move(1020, 540); await t.page.mouse.down(); await t.glide(1020, 540, 1080, 470, 20); await t.page.mouse.up(); await t.still("after drop");
    ok((await t.state()).cables[1].looseA, "end a did not go loose");
    await t.page.mouse.move(c.b[0], c.b[1]); await t.page.mouse.down(); await t.glide(c.b[0], c.b[1], 120, 120, 80); await t.page.waitForTimeout(600);
    const st = await t.state(); const hand = st.cables[1].pts[st.N - 1];
    ok(Math.hypot(hand[0] - st.mouse[0], hand[1] - st.mouse[1]) < 20, `hand stalled: ${hand.map(Math.round)} vs ${st.mouse}`);
    await t.page.mouse.up();
  }],

  // the plug is in the hand: it is where the cursor is, every frame, however fast
  "hand follows the cursor at speed (dpr2)": [HI, 704995189, async (t) => {
    const s = await t.state();
    // a loose far end so reach never limits the hand
    const i = s.cables.map((c, i) => [c.len, i]).sort((x, y) => y[0] - x[0])[0][1]; const c = s.cables[i];
    await t.page.mouse.move(c.a[0], c.a[1]); await t.page.mouse.down(); await t.glide(c.a[0], c.a[1], c.a[0] + 40, c.a[1] - 50, 20); await t.page.mouse.up(); await t.still("after drop");
    ok((await t.state()).cables[i].looseA, "end a did not go loose");
    const b = (await t.state()).cables[i].b;
    await t.page.mouse.move(b[0], b[1]); await t.page.mouse.down();
    await t.page.evaluate((i) => { const s = document.querySelector("canvas").__pb3d(); window.__lag = []; const f = () => { const c = s.cables[i]; const h = c.pts[s.N - 1]; const m = s.rec.frames.at(-1); window.__lag.push(Math.hypot(h.x / s.dpr - m[0], h.y / s.dpr - m[1])); const q = c.pts[s.N - 2]; window.__str = Math.max(window.__str || 0, Math.hypot(h.x - q.x, h.y - q.y, h.z - q.z) / c.rest); if (window.__lag.length < 200) requestAnimationFrame(f); }; requestAnimationFrame(f); }, i);
    // 70 CSS px a frame: a brisk swipe
    await t.glide(b[0], b[1], 200, 140, 12); await t.glide(200, 140, 1200, 700, 14); await t.page.waitForTimeout(300);
    const lag = await t.page.evaluate(() => window.__lag);
    if (process.env.PB_VERBOSE) console.log(`    lag max ${Math.max(...lag).toFixed(1)}px; first segment stretch max ${(await t.page.evaluate(() => window.__str)).toFixed(2)}× rest`);
    ok(Math.max(...lag) < 6, `hand trails the cursor: max ${Math.max(...lag).toFixed(1)}px, per frame ${lag.map((v) => v.toFixed(0)).join(" ")}`);
    await t.page.mouse.up();
  }],

  // the sides of the screen are not walls: a hanging end swung at the edge goes past it
  "cord swings off the side of the screen": [LO, 704995189, async (t) => {
    const s = await t.state();
    const i = s.cables.map((c, i) => [c.len, i]).sort((x, y) => y[0] - x[0])[0][1]; const c = s.cables[i];
    await t.page.mouse.move(c.a[0], c.a[1]); await t.page.mouse.down(); await t.glide(c.a[0], c.a[1], c.a[0] + 40, c.a[1] - 50, 20); await t.page.mouse.up(); await t.still("after drop");
    ok((await t.state()).cables[i].looseA, "end a did not go loose");
    const b = (await t.state()).cables[i].b;
    await t.page.mouse.move(b[0], b[1]); await t.page.mouse.down();
    await t.page.evaluate((i) => { const s = document.querySelector("canvas").__pb3d(); window.__maxx = 0; const f = () => { window.__maxx = Math.max(window.__maxx, ...s.cables[i].pts.map((q) => q.x / s.dpr)); requestAnimationFrame(f); }; requestAnimationFrame(f); }, i);
    // a brisk swing to the right edge, then hold: the loose end carries on past it
    await t.glide(b[0], b[1], 1195, 300, 10); await t.page.waitForTimeout(1200);
    const maxx = await t.page.evaluate(() => window.__maxx);
    ok(maxx > 1200, `the cord stopped at the edge: rightmost point ${maxx.toFixed(0)}px of 1200`);
    await t.page.mouse.up();
  }],

  // Jango's recording: held still for seconds, the cord kept moving ("endless motion")
  "held still, the cord comes to rest (594964621)": [HI, 594964621, async (t) => {
    const rec = REC(594964621);
    // per-frame max point motion of the dragged cord and where it is, sampled through the hold
    const probe = () => { const s = document.querySelector("canvas").__pb3d(); const d = s.drag; if (!d) return null; const c = d.cable; const last = window.__lastPts; const cur = c.pts.map((q) => [q.x, q.y, q.z]); let m = 0, mi = -1; if (last) cur.forEach((q, i) => { const v = Math.hypot(q[0] - last[i][0], q[1] - last[i][1]); if (v > m) { m = v; mi = i; } }); window.__lastPts = cur;
      return { m: +(m / s.dpr).toFixed(1), mi, at: mi >= 0 ? cur[mi].map((v) => Math.round(v / s.dpr)) : null, pins: Array.from(c.stuck || []).filter(Boolean).length, pressing: (c.pressing || []).map((q) => q.name), stretch: +((() => { let a = 0; for (let i = 0; i < s.N - 1; i++) a += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y, c.pts[i + 1].z - c.pts[i].z); return a / c.len; })()).toFixed(3), mouse: s.rec.frames.at(-1) }; };
    const log = await replay(t, rec, { from: 180, every: 12, watch: () => t.page.evaluate(probe) });
    await t.still("after replay");
    if (process.env.PB_VERBOSE) console.log(log.map(([f, r]) => `${f}: move ${r.m}@${r.mi} ${r.at} pins ${r.pins} press ${r.pressing} stretch ${r.stretch} mouse ${r.mouse}`).join("\n"));
    // the mouse is still from frame ~200 to ~410: the cord must be still by 300
    const late = log.filter(([f]) => f >= 300 && f <= 400);
    const worst = Math.max(...late.map(([, r]) => r.m));
    ok(worst < 0.5, `cord still moving ${worst}px/frame while held still`);
  }],

  // Jango (seed 973385617, not reproducible at replay speed): a cord hooked on the TIP of another cord's plug
  // and swept round the SOCKET end of that plug meets nothing there — the post is the plug and its nut only
  "no barrier above a socket": [LO, 704995189, async (t) => {
    const s = await t.state(); ok(s.cables[1].a.join() === "1020,540", `deal changed: ${JSON.stringify(s.cables)}`);
    // red a is under black: pulled up it hooks black's plug b (900,540; barrel down to ~581, socket end up).
    // Then, before the tug pops it, the hand sweeps over the socket end: the arm from the hook to the hand
    // must stay a straight taut line — a kink at x=900 above the nut is a wall
    const probe = () => { const s = document.querySelector("canvas").__pb3d(); const c = s.drag.cable; const h = c.pts[0]; const tip = { x: 900 * s.dpr, y: 581 * s.dpr }; const L = Math.hypot(tip.x - h.x, tip.y - h.y) || 1; let worst = 0, at = null; for (let i = 1; i < s.N; i++) { const p = c.pts[i]; const t = ((p.x - h.x) * (tip.x - h.x) + (p.y - h.y) * (tip.y - h.y)) / (L * L); if (t < 0.1 || t > 0.9) continue; const d = Math.abs((p.x - h.x) * (tip.y - h.y) - (p.y - h.y) * (tip.x - h.x)) / L; if (d > worst) { worst = d; at = [Math.round(p.x / s.dpr), Math.round(p.y / s.dpr)]; } } return { off: +(worst / s.dpr).toFixed(0), at, hook: c.hookKey, popped: !!s.cables[0].looseB, hand: [Math.round(h.x / s.dpr), Math.round(h.y / s.dpr)] }; };
    await t.page.mouse.move(1020, 540); await t.page.mouse.down();
    await t.glide(1020, 540, 1000, 400, 12);
    const log = [];
    let from = [1000, 400];
    for (const [x, y] of [[1120, 380], [1120, 250], [980, 180], [820, 220], [700, 320]]) { for (let k = 1; k <= 6; k++) { await t.page.mouse.move(from[0] + (x - from[0]) * k / 6, from[1] + (y - from[1]) * k / 6); await t.page.waitForTimeout(16); log.push(await t.page.evaluate(probe)); } from = [x, y]; }
    if (process.env.PB_VERBOSE) console.log(JSON.stringify(log.map((r) => [r.hand, r.hook, r.off, r.at, r.popped])));
    ok(log.some((r) => r.hook === "0b"), "never hooked on black's plug b");
    const above = log.filter((r) => r.hook === "0b" && !r.popped && r.hand[1] < 300 && r.hand[0] < 1000 && r.hand[0] > 800);
    ok(above.length > 0, "the plug popped before the hand got above its socket; sweep faster");
    // the arm may bend round the plug itself (nut end at y≈521, tip at 581), nowhere else
    const worst = above.reduce((m, r) => (r.off > m.off ? r : m));
    const offPlug = worst.at ? Math.hypot(worst.at[0] - 900, worst.at[1] - Math.max(521, Math.min(581, worst.at[1]))) : 0;
    ok(worst.off < 30 || offPlug < 30, `the arm to the hand kinks ${worst.off}px off its line at ${worst.at}, ${offPlug.toFixed(0)}px from the plug: a wall above the socket`);
    await t.page.mouse.up();
  }],

  // a hole another cord lies across is not open
  "covered hole refuses a plug": [LO, 704995189, async (t) => {
    const s = await t.state();
    // a free hole with the other cord's body across it, if this deal has one
    const hole = await t.page.evaluate(() => { const s = document.querySelector("canvas").__pb3d(); const taken = (j) => s.cables.some((k) => k.a === j || k.b === j); const R = s.cables[1]; let best = null, bd = 1e9; for (const j of s.jacks) { if (taken(j)) continue; const d = Math.min(...s.cables[0].pts.map((q) => Math.hypot(q.x - j.x, q.y - j.y))); if (d < bd) { bd = d; best = [j.x / s.dpr, j.y / s.dpr]; } } return { best, d: bd / s.dpr, R: 19 + R.r / s.dpr }; });
    if (hole.d >= hole.R) { console.log("    (no covered hole on this deal; skipped)"); return; }
    const a = s.cables[1].a;
    await t.page.mouse.move(a[0], a[1]); await t.page.mouse.down(); await t.glide(a[0], a[1], hole.best[0] + 3, hole.best[1] + 3, 40); await t.page.mouse.up(); await t.page.waitForTimeout(1500);
    const after = await t.state(); ok(after.cables[1].a.join() !== hole.best.join(), `plug seated in a covered hole ${hole.best}`);
  }],
};
function noPlugUnderCord(s) {
  for (const [ci, c] of s.cables.entries()) for (const j of [c.a, c.b]) for (const [oi, o] of s.cables.entries()) {
    if (oi === ci) continue;
    const d = Math.min(...o.pts.map((q) => Math.hypot(q[0] - j[0], q[1] - j[1])));
    ok(d >= 19 + 4.25, `plug at ${j} sits under cord ${oi} (${d.toFixed(0)}px)`);
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const filter = process.argv[2] || "";
let browser;
try { browser = await chromium.launch(); } catch (e) { console.error("chromium launch failed:", e.message); process.exit(2); }
let failed = 0;
for (const [name, [opts, seed, body]] of Object.entries(scenarios)) {
  if (!name.includes(filter)) continue;
  const t = await open(browser, opts, seed);
  try {
    await t.still("start");
    await body(t);
    await t.still("end");
    console.log(`ok   ${name}`);
  } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
  await t.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : "all still, all passed");
process.exit(failed ? 1 : 0);
