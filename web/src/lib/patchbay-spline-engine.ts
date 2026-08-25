// @ts-nocheck — Option B: the patch bay as ART-DIRECTED SPLINES, not a physics
// sim. A cord is a single smooth curve between its two plugged holes, drooping
// by exactly the slack it has (its arc length is always its fixed length). There
// is no integrator, so a cord CANNOT kink, jitter, or tunnel — it is a curve,
// full stop. Dragging an end reshapes the curve smoothly. Over/under is an
// explicit z-order (the cord you grab comes to the top). The board, plugs, and
// cord look are the same as before; only the thing driving the shape changed.

export const PATCHBAY_SPLINE_VERSION = "spline-v1";

export function startPatchBaySpline(canvas: HTMLCanvasElement, opts: { cables?: number } = {}): () => void {
  const ctx = canvas.getContext("2d");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 24;                       // sample points along each cord (for the existing renderer)
  let w, h, dpr, jacks = [], cables = [], panel, JR = 0, rafId = 0;
  const mouse = { x: -1e9, y: -1e9 };
  let drag = null;                    // { cable, end: "a"|"b" }
  let zTop = 1;                       // next z-order to hand out (grabbed cord rises to the top)
  const rec = { seed: 0, w: innerWidth, h: innerHeight, dpr: 0, frames: [], events: [] };

  let seed = (typeof window !== "undefined" && (window as unknown as { __patchbaySeed?: number }).__patchbaySeed) || ((Math.random() * 2 ** 31) | 0) || 1;
  rec.seed = seed;
  let _s = seed >>> 0;
  const rand = () => {
    _s = (_s + 0x6D2B79F5) | 0;
    let q = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };

  const COLORS = [
    { rgb: [40, 40, 40], a: 0.3 }, { rgb: [214, 48, 49], a: 0.48 },
    { rgb: [90, 90, 90], a: 0.22 }, { rgb: [230, 126, 34], a: 0.48 },
    { rgb: [226, 107, 168], a: 0.48 }, { rgb: [206, 162, 8], a: 0.5 },
    { rgb: [25, 25, 25], a: 0.34 }, { rgb: [41, 128, 185], a: 0.46 },
  ];

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    const gap = 120 * dpr;
    JR = 19 * dpr;
    jacks = [];
    panel = document.createElement("canvas");
    panel.width = w; panel.height = h;
    const pctx = panel.getContext("2d");
    const ink = (a) => "rgba(0,0,0," + a + ")";
    for (let gx = gap / 2; gx < w; gx += gap) for (let gy = gap / 2; gy < h; gy += gap) {
      jacks.push({ x: gx, y: gy });
      pctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        pctx[i ? "lineTo" : "moveTo"](gx + Math.cos(a) * JR * 1.45, gy + Math.sin(a) * JR * 1.45);
      }
      pctx.closePath(); pctx.strokeStyle = ink(0.16); pctx.lineWidth = 1.6 * dpr; pctx.stroke();
      pctx.beginPath(); pctx.arc(gx, gy, JR, 0, 7); pctx.fillStyle = ink(0.1); pctx.fill();
      pctx.beginPath(); pctx.arc(gx, gy, JR * 0.78, 0, 7); pctx.strokeStyle = ink(0.34); pctx.lineWidth = 2 * dpr; pctx.stroke();
      pctx.beginPath(); pctx.arc(gx, gy, JR * 0.44, 0, 7); pctx.fillStyle = ink(0.55); pctx.fill();
    }
    if (!cables.length) deal(gap); else for (const c of cables) shape(c);
  }

  function jackTaken(j) { return cables.some((c) => c.na === j || c.nb === j); }
  function pickPair() {
    const free = jacks.filter((j) => !jackTaken(j));
    const a = free[(rand() * free.length) | 0];
    let b = null, tries = 0;
    while (tries++ < 60 && free.length > 1) {
      const cand = free[(rand() * free.length) | 0];
      const d = Math.hypot(cand.x - a.x, cand.y - a.y);
      if (cand !== a && d > w * 0.14 && d < w * 0.5) { b = cand; break; }
    }
    return [a, b || free.find((j) => j !== a)];
  }

  function deal(gap) {
    cables = [];
    const count = Math.min(opts.cables ?? 8, Math.floor(jacks.length / 4));
    for (let i = 0; i < count; i++) {
      const [ja, jb] = pickPair();
      if (!ja || !jb) break;
      const c = {
        na: ja, nb: jb,                       // the holes each end is plugged into
        a: { x: ja.x, y: ja.y }, b: { x: jb.x, y: jb.y }, // current end positions
        anim: null,                            // seat animation, if any
        slack: 1.22 + rand() * 0.5,
        color: COLORS[i % COLORS.length],
        wear: 0.72 + rand() * 0.5,
        hueJit: [0, 1, 2].map(() => (rand() - 0.5) * 34),
        braid: 0.8 + rand() * 0.9,
        gloss: 0.3 + rand() * 0.35,
        width: 8.5 * dpr,
        z: i + 1,
        pts: [],
      };
      c.len = Math.hypot(jb.x - ja.x, jb.y - ja.y) * c.slack;
      cables.push(c);
      shape(c);
    }
    zTop = cables.length + 1;
  }

  // ── the curve ──────────────────────────────────────────────────────────────
  // A cord is a quadratic curve from a to b whose control point is pushed to the
  // low side of the chord by `sag`. `sag` is solved so the curve's arc length
  // equals the cord's fixed length: taut when the ends are len apart, deep when
  // they are close. This IS the fixed-length constraint — exact, and by
  // construction smooth.
  function shape(c) {
    const ax = c.a.x, ay = c.a.y, bx = c.b.x, by = c.b.y;
    const dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1e-6;
    let px = -dy / dl, py = dx / dl; if (py < 0) { px = -px; py = -py; }   // perpendicular, toward the low side
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const S = 16;
    const arcLen = (sag) => {
      const cx = mx + px * sag, cy = my + py * sag;
      let L = 0, prevx = ax, prevy = ay;
      for (let k = 1; k <= S; k++) {
        const t = k / S, u = 1 - t;
        const qx = u * u * ax + 2 * u * t * cx + t * t * bx;
        const qy = u * u * ay + 2 * u * t * cy + t * t * by;
        L += Math.hypot(qx - prevx, qy - prevy); prevx = qx; prevy = qy;
      }
      return L;
    };
    let sag = 0;
    if (dl < c.len - 0.5) {          // there is slack to hang
      let lo = 0, hi = c.len;
      for (let it = 0; it < 22; it++) { const md = (lo + hi) / 2; if (arcLen(md) < c.len) lo = md; else hi = md; }
      sag = (lo + hi) / 2;
    }
    const cx = mx + px * sag, cy = my + py * sag;
    c.pts.length = 0;
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1), u = 1 - t;
      c.pts.push({ x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by });
    }
  }

  function step() {
    if (drag) {
      const c = drag.cable, end = drag.end;
      const far = end === "a" ? c.b : c.a;
      // the free end can reach at most `len` from the plugged end — no stretching
      let mx = mouse.x, my = mouse.y;
      const rx = mx - far.x, ry = my - far.y, rd = Math.hypot(rx, ry);
      if (rd > c.len && rd > 1e-6) { mx = far.x + (rx / rd) * c.len; my = far.y + (ry / rd) * c.len; }
      c[end].x = mx; c[end].y = my;
    }
    for (const c of cables) {
      if (c.anim) {                   // ease a released end home into its hole
        c.anim.t = Math.min(1, c.anim.t + 0.12);
        const k = c.anim.t < 0.5 ? 2 * c.anim.t * c.anim.t : 1 - (-2 * c.anim.t + 2) ** 2 / 2;
        const e = c.anim.end, to = c.anim.end === "a" ? c.na : c.nb;
        c[e].x = c.anim.fx + (to.x - c.anim.fx) * k;
        c[e].y = c.anim.fy + (to.y - c.anim.fy) * k;
        if (c.anim.t >= 1) { c[e].x = to.x; c[e].y = to.y; c.anim = null; }
      }
      shape(c);
    }
  }

  // ── drawing (cord + plug look identical to the physics engine) ───────────────
  function tint(c, aMul, shade) {
    const k = shade === undefined ? 1 : shade;
    const fade = Math.max(0, Math.min(0.22, (1.22 - c.wear) * 0.35));
    return "rgb(" + c.color.rgb.map((v, i) => Math.round(Math.max(0, Math.min(255, v * k + c.hueJit[i])) * (1 - fade) + 255 * fade)).join(",") + ")";
  }
  function ropePath(pts, off) {
    const m = pts.length;
    const P = off ? pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1e-6;
      return { x: p.x - (ty / l) * off, y: p.y + (tx / l) * off };
    }) : pts;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < m - 1; i++) ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
    ctx.lineTo(P[m - 1].x, P[m - 1].y);
  }
  function sliceByArc(pts, base, from, to) {
    const out = []; let acc = base;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], d = Math.hypot(q.x - p.x, q.y - p.y) || 1e-6;
      const s = Math.max(from, acc), e = Math.min(to, acc + d);
      if (e > s) {
        const at = (u) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
        if (!out.length) out.push(at((s - acc) / d));
        out.push(at((e - acc) / d));
      }
      acc += d;
    }
    return out.length >= 2 ? out : null;
  }
  function drawCable(c) {
    const pts = c.pts;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 5 * dpr; ctx.shadowOffsetY = 4 * dpr;
    ropePath(pts, 0); ctx.strokeStyle = tint(c, 0.9, 0.55); ctx.lineWidth = c.width * 1.9; ctx.stroke();
    ctx.restore();
    ropePath(pts, -c.width * 0.12); ctx.strokeStyle = tint(c, 1); ctx.lineWidth = c.width * 1.45; ctx.stroke();
    let arc = 0;
    for (let i = 0; i < N - 1; i++) arc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const CUFF = 0.18 * c.len, roomy = arc > CUFF * 2.4;
    const mid = roomy ? (arc - 2 * CUFF) / (c.len - 2 * CUFF) : arc / c.len;
    const runs = roomy
      ? [{ a: 0, b: CUFF, k: 1, ph: (s) => s },
         { a: CUFF, b: arc - CUFF, k: mid, ph: (s) => CUFF * mid - CUFF + s },
         { a: arc - CUFF, b: arc, k: 1, ph: (s) => c.len - arc + s }]
      : [{ a: 0, b: arc, k: mid, ph: (s) => s }];
    const layer = (pattern, oy, stroke, wide) => {
      ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, wide);
      for (const r of runs) {
        const sub = sliceByArc(pts, 0, r.a, r.b);
        if (!sub) continue;
        ctx.setLineDash(pattern.map((v) => v * r.k));
        ctx.lineDashOffset = r.ph(r.a);
        ropePath(sub, oy); ctx.stroke();
      }
    };
    ctx.save();
    layer([2.2 * dpr * c.braid, 3.4 * dpr * c.braid], c.width * 0.18, tint(c, 0.5, 0.4), c.width * 0.5);
    layer([9 * dpr * c.braid, 5 * dpr, 4 * dpr * c.braid, 7 * dpr], -c.width * 0.38, "rgba(255,255,255," + c.gloss.toFixed(2) + ")", c.width * 0.3);
    ctx.restore();
    ctx.setLineDash([]);
  }
  function drawPlug(c, end) {
    const p0 = end === "a" ? c.pts[0] : c.pts[N - 1];
    const p1 = end === "a" ? c.pts[1] : c.pts[N - 2];
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len, collar = 16 * dpr;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p0.x + ux * collar, p0.y + uy * collar);
    ctx.strokeStyle = tint(c, 0.8, 0.5); ctx.lineWidth = c.width * 1.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(p0.x, p0.y, c.width * 1.35, 0, 7);
    ctx.fillStyle = tint(c, 1.05, 0.4); ctx.fill();
    ctx.beginPath(); ctx.arc(p0.x - ux * 2 * dpr, p0.y - uy * 2 * dpr, c.width * 0.7, 0, 7);
    ctx.fillStyle = tint(c, 0.85, 0.5); ctx.fill();
  }

  function draw() {
    step();
    rec.dpr = dpr;
    rec.frames.push([Math.round(mouse.x / dpr), Math.round(mouse.y / dpr)]);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(panel, 0, 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const order = cables.slice().sort((p, q) => p.z - q.z);   // low z first, grabbed (high z) on top
    for (const c of order) drawCable(c);
    for (const c of order) { drawPlug(c, "a"); drawPlug(c, "b"); }
    if (canvas.__lab) {
      ctx.save(); ctx.font = "600 " + 11 * dpr + "px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(120,120,120,0.9)"; ctx.fillText("f " + rec.frames.length, 12 * dpr, h - 12 * dpr); ctx.restore();
    }
    if (!REDUCED) rafId = requestAnimationFrame(draw);
  }

  // ── interaction ──────────────────────────────────────────────────────────────
  const GRAB = () => 20 * dpr;
  function plugAt(x, y) {
    // topmost cord first
    const order = cables.slice().sort((p, q) => q.z - p.z);
    for (const c of order) {
      if (Math.hypot(c.a.x - x, c.a.y - y) < GRAB()) return { cable: c, end: "a" };
      if (Math.hypot(c.b.x - x, c.b.y - y) < GRAB()) return { cable: c, end: "b" };
    }
    return null;
  }
  function trySeat() {
    const c = drag.cable, end = drag.end, p = c[end], far = end === "a" ? c.b : c.a;
    let best = null, bd = 44 * dpr;
    for (const j of jacks) {
      if (jackTaken(j) && j !== (end === "a" ? c.na : c.nb)) continue;   // free, or our own hole
      if (Math.hypot(j.x - far.x, j.y - far.y) > c.len) continue;        // out of reach
      const d = Math.hypot(j.x - p.x, j.y - p.y); if (d < bd) { bd = d; best = j; }
    }
    if (!best) best = end === "a" ? c.na : c.nb;    // nowhere reachable → spring home
    if (end === "a") c.na = best; else c.nb = best;
    c.anim = { end, fx: p.x, fy: p.y, t: 0 };
    drag = null; canvas.style.cursor = "default";
  }

  canvas.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr;
    if (!drag) canvas.style.cursor = plugAt(mouse.x, mouse.y) ? "grab" : "default";
  });
  canvas.addEventListener("pointerdown", (e) => {
    const x = e.clientX * dpr, y = e.clientY * dpr;
    rec.events.push([rec.frames.length, "down", e.clientX, e.clientY]);
    if (drag) { trySeat(); return; }
    const hit = plugAt(x, y); if (!hit) return;
    drag = hit; hit.cable.z = zTop++; hit.cable.anim = null;
    mouse.x = x; mouse.y = y; canvas.style.cursor = "grabbing";
    try { canvas.setPointerCapture(e.pointerId); } catch { /* headless */ }
  });
  canvas.addEventListener("pointerup", () => { rec.events.push([rec.frames.length, "up", 0, 0]); if (drag) trySeat(); });

  canvas.__pb3d = () => ({ cables, jacks, dpr, N, drag, rec });
  if (canvas.__lab == null) canvas.__lab = false;
  const onKey = (e) => { if (e.key === "r" || e.key === "R") navigator.clipboard?.writeText(JSON.stringify(rec)).then(() => canvas.dispatchEvent(new CustomEvent("patchbay:copied"))); };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", size);
  size();
  draw();
  return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); };
}
