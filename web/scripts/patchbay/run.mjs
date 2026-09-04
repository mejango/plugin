// Patch-bay scenario suite: drives /lab3d in headless Chromium and checks the
// physical rules Jango has set. Every scenario is framed the same way: the
// cords must be STILL (asleep, zero motion) before the action and still again
// after it. Needs the dev server on :3004 and a playwright-core somewhere on
// this machine (the app does not depend on one).
//   npm run test:patchbay            all scenarios
//   npm run test:patchbay -- tug     scenarios whose name contains "tug"
import { existsSync } from "node:fs";
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
