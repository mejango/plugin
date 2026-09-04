// @ts-nocheck — the interactive 2.5D patch bay: a bare board, cords that are
// solid to each other because they have a real height, and plugs that seat in
// holes. Over/under is z; there is no crossing bookkeeping. Drawing is ported
// from the flat engine (the cord and plug look are unchanged); the physics is
// the 3D solver in patchbay3d.ts.

import { bend3, collide3, constrainLength3, integrate3, offPost3, unkink3 } from "./patchbay3d";

export const PATCHBAY3D_VERSION = "bare-v3";

export function startPatchBay3D(canvas: HTMLCanvasElement, opts: { cables?: number } = {}): () => void {
  const ctx = canvas.getContext("2d");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 30;   // enough segments that a dragged cord curls instead of kinking
  let w, h, dpr, jacks = [], cables = [], panel, JR = 0, rafId = 0;
  const mouse = { x: -1e9, y: -1e9 };
  let drag = null;                    // { cable, end: "a"|"b" }
  const rec = { seed: 0, w: innerWidth, h: innerHeight, dpr: 0, frames: [], events: [] };

  // window.__patchbaySeed pins the deal, so a board can be reproduced exactly
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
    if (!cables.length) deal(gap);
    else {
      // the grid was rebuilt: every cord's jacks are objects from the old one
      drag = null;
      // each end takes the nearest hole still free, so a shrink that pushes
      // several ends off the board cannot pile them into one hole
      const nearest = (p) => jacks.filter((j) => !jackTaken(j)).reduce((m, j) => (Math.hypot(j.x - p.x, j.y - p.y) < Math.hypot(m.x - p.x, m.y - p.y) ? j : m));
      for (const c of cables) {
        c.a = c.na = nearest(c.na); c.b = c.nb = nearest(c.nb); c.move = 1;
        c.len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) * c.slack; c.rest = c.len / (N - 1);
        reproject(c);
      }
    }
  }

  function jackTaken(j) { return cables.some((c) => c.a === j || c.b === j || c.na === j || c.nb === j); }
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

  function ropeInit(c) {
    c.pts = []; c.prev = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const x = c.a.x + (c.b.x - c.a.x) * k;
      const y = c.a.y + (c.b.y - c.a.y) * k + Math.sin(k * Math.PI) * 20 * dpr;
      c.pts.push({ x, y, z: 0 });
      c.prev.push({ x, y, z: 0 });
    }
  }
  function reproject(c) { ropeInit(c); }

  function deal(gap) {
    cables = [];
    const count = Math.min(opts.cables ?? 8, Math.floor(jacks.length / 4));
    for (let i = 0; i < count; i++) {
      const [a, b] = pickPair();
      if (!a || !b) break;
      const c = {
        a, b, na: a, nb: b, move: 1,
        slack: 1.2 + rand() * 0.35,
        color: COLORS[i % COLORS.length],
        wear: 0.72 + rand() * 0.5,
        hueJit: [0, 1, 2].map(() => (rand() - 0.5) * 34),
        braid: 0.8 + rand() * 0.9,
        gloss: 0.3 + rand() * 0.35,
        width: 8.5 * dpr,
        pts: [], prev: [],
      };
      ropeInit(c);
      c.len = Math.hypot(b.x - a.x, b.y - a.y) * c.slack;
      c.rest = c.len / (N - 1);
      c.r = c.width * 0.5;
      cables.push(c);
    }
    for (let i = 0; i < 200; i++) step();
  }

  // ── physics ──────────────────────────────────────────────────────────────
  // Gravity and damping only: a hanging cord swings like a pendulum and settles
  // like one. STIFF is the cord's resistance to bending, LEN the iterations that
  // hold its length — a cord's length is the one thing that must never give.
  const G = 2.5, GZ = 0.06, DAMP = 0.975, LIFT_Z = 26;
  const STIFF = 0.34, LEN = 24, SUB = 8, MIN_BEND = 72, UNKINK = 0.35;
  // A hand moves at a hand's speed. Without this a flick asks the plug to cross
  // most of the cord's length in one frame, and no solver can absorb that while
  // holding the length — the cord stretches for a frame. 64px a frame is 8 per
  // substep, under a cord's own thickness.
  const MAX_STEP = 64;

  function ropeView(c) {
    return { pts: c.pts, prev: c.prev, r: c.r, rest: c.rest,
      heldA: heldEnd(c, "a"), heldB: heldEnd(c, "b") };
  }
  function heldEnd(c, name) {
    return (drag && drag.cable === c && drag.end === name) || (c.move < 1 && (name === "a" ? c.a !== c.na : c.b !== c.nb));
  }

  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }

  function step() {
    // aim the held plug at the mouse, or animate a seating plug home
    let held = null;
    if (drag) held = { c: drag.cable, name: drag.end, to: { x: mouse.x, y: mouse.y, z: LIFT_Z } };

    const ropes = cables.map(ropeView);
    for (const c of cables) {
      integrate3({ pts: c.pts, prev: c.prev, r: c.r, rest: c.rest, heldA: heldEnd(c, "a"), heldB: heldEnd(c, "b") }, G * dpr, GZ, DAMP);
    }
    // Where each held plug starts this frame, so it can be walked to the mouse
    // across the substeps. A hand that teleports a hundred pixels in one frame
    // yanks the first segment to many times its rest length, and the length
    // solve cannot undo that within the frame — the cord visibly stretches.
    const from = {};
    for (const c of cables) for (const [name, idx] of [["a", 0], ["b", N - 1]])
      if (drag && drag.cable === c && drag.end === name) from[name] = { x: c.pts[idx].x, y: c.pts[idx].y };
    // pin ends: seated plugs sit at their jack (z 0), the held plug rides the hand
    const pin = (f = 1) => {
      for (const c of cables) {
        for (const [name, idx] of [["a", 0], ["b", N - 1]]) {
          if (drag && drag.cable === c && drag.end === name) {
            // A cord cannot be stretched: the hand can only reach a circle of
            // the cord's length about the end that stays put. Past that the plug
            // stops, taut, instead of following the cursor.
            const far = c.pts[name === "a" ? N - 1 : 0];
            const maxR = Math.sqrt(Math.max(0, c.len * c.len - LIFT_Z * LIFT_Z));
            let mx = mouse.x, my = mouse.y;
            const rx = mx - far.x, ry = my - far.y, rd = Math.hypot(rx, ry);
            if (rd > maxR && rd > 1e-6) { mx = far.x + (rx / rd) * maxR; my = far.y + (ry / rd) * maxR; }
            // near an open hole the plug finds it: the hand's aim is blended
            // toward the hole, fully there at its centre, untouched at SNAP
            const s = socketNear(c, name, mx, my);
            if (s) { const k = 1 - s.d / SNAP(); const e = k * k * (3 - 2 * k); mx += (s.j.x - mx) * e; my += (s.j.y - my) * e; }
            const fr = from[name] || { x: mx, y: my };
            const sx = mx - fr.x, sy = my - fr.y, sd = Math.hypot(sx, sy);
            if (sd > MAX_STEP) { mx = fr.x + (sx / sd) * MAX_STEP; my = fr.y + (sy / sd) * MAX_STEP; }
            const p = c.pts[idx];
            p.x = fr.x + (mx - fr.x) * f; p.y = fr.y + (my - fr.y) * f; p.z = LIFT_Z;
          } else if (c.move < 1) {
            const k = ease(c.move);
            const from = name === "a" ? c.a : c.b, to = name === "a" ? c.na : c.nb;
            const p = c.pts[idx]; p.x = from.x + (to.x - from.x) * k; p.y = from.y + (to.y - from.y) * k; p.z = LIFT_Z * (1 - k);
          } else {
            const j = name === "a" ? c.a : c.b;
            const p = c.pts[idx]; p.x = j.x; p.y = j.y; p.z = 0;
          }
        }
      }
    };
    // Each substep: bend, then length, then the cord against ITSELF (so a
    // dragged cord curls over its own body), and the length again last — the
    // length is the constraint that must hold, so it gets the final word.
    for (let s = 1; s <= SUB; s++) {
      const f = s / SUB;
      for (const c of cables) {
        const v = ropeView(c);
        bend3(v, STIFF);
        unkink3(v, MIN_BEND, UNKINK);
        constrainLength3(v, LEN);
      }
      pin(f);
      for (const r of ropes) collide3([r], 2);
      pin(f);
      for (const c of cables) offPosts(c);
      pin(f);
      for (const c of cables) constrainLength3(ropeView(c), LEN);
      pin(f);
    }
    for (const c of cables) if (c.move < 1) {
      c.move = Math.min(1, c.move + (c.moveSpeed || 0.05));
      if (c.move >= 1) { c.a = c.na; c.b = c.nb; }   // the seat is done: the plug lives in the hole now
    }
  }

  // A seated plug is a post: a capsule from the jack along the barrel, as
  // drawn, standing off the board. No cord at board height passes through
  // one — not another cord, not its own cord folding back over its barrel.
  // A held or still-seating plug is in the air and is no obstacle.
  const POST_H = LIFT_Z * 0.85, BARREL = () => 15 * dpr * 1.8;
  function posts() {
    const out = [];
    for (const c of cables) {
      if (c.move < 1 || (drag && drag.cable === c)) continue;
      for (const [name, i0, i1] of [["a", 0, 2], ["b", N - 1, N - 3]]) {
        const p0 = c.pts[i0], p1 = c.pts[i1];
        const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        out.push({ c, name, x0: p0.x, y0: p0.y, x1: p0.x + ((p1.x - p0.x) / l) * BARREL(), y1: p0.y + ((p1.y - p0.y) / l) * BARREL(), r: c.width * 1.2 });
      }
    }
    return out;
  }
  function offPosts(c) {
    const v = ropeView(c);
    for (const post of posts()) {
      // its own cord's first stretch IS the barrel: skip what would lie inside
      // the capsule when the cord runs straight out of it
      const skip = post.c === c ? Math.ceil((BARREL() + post.r + c.r) / c.rest) : -1;
      if (skip < 0) offPost3(v, post, POST_H);
      else if (post.name === "a") offPost3(v, post, POST_H, 0, skip);
      else offPost3(v, post, POST_H, N - 1 - skip, N - 1);
    }
  }
  const SNAP = () => 56 * dpr;
  // nearest open hole within SNAP of (x,y) that the cord can reach from its
  // other end — a cord cannot be stretched to a hole
  function socketNear(c, end, x, y) {
    const far = c.pts[end === "a" ? N - 1 : 0];
    const reach = Math.sqrt(Math.max(0, c.len * c.len - LIFT_Z * LIFT_Z));
    let best = null, bd = SNAP();
    for (const j of jacks) {
      if (jackTaken(j) || Math.hypot(j.x - far.x, j.y - far.y) > reach) continue;
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < bd) { bd = d; best = j; }
    }
    return best && { j: best, d: bd };
  }

  // ── drawing (ported from the flat engine; reads x,y only) ─────────────────
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
  function drawCable(c, pts, shadow, dashFrom) {
    if (shadow) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 5 * dpr; ctx.shadowOffsetY = 4 * dpr; }
    ropePath(pts, 0); ctx.strokeStyle = tint(c, 0.9, 0.55); ctx.lineWidth = c.width * 1.9; ctx.stroke();
    if (shadow) ctx.restore();
    ropePath(pts, -c.width * 0.12); ctx.strokeStyle = tint(c, 1); ctx.lineWidth = c.width * 1.45; ctx.stroke();
    let arc = 0;
    for (let i = 0; i < N - 1; i++) arc += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y);
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
        const sub = sliceByArc(pts, dashFrom, r.a, r.b);
        if (!sub) continue;
        ctx.setLineDash(pattern.map((v) => v * r.k));
        ctx.lineDashOffset = r.ph(Math.max(r.a, dashFrom));
        ropePath(sub, oy); ctx.stroke();
      }
    };
    ctx.save();
    layer([2.2 * dpr * c.braid, 3.4 * dpr * c.braid], c.width * 0.18, tint(c, 0.5, 0.4), c.width * 0.5);
    layer([9 * dpr * c.braid, 5 * dpr, 4 * dpr * c.braid, 7 * dpr], -c.width * 0.38, "rgba(255,255,255," + c.gloss.toFixed(2) + ")", c.width * 0.3);
    ctx.restore();
    ctx.setLineDash([]);
  }
  // The barrel is rigid, so it points where the cord's first stretch goes,
  // not where the first 17px segment happens to whip; and it turns with a
  // little inertia, as a plug in a hand does, instead of flipping in a frame.
  function drawPlug(c, name, p0, p1) {
    const want = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const key = "ang" + name;
    let ang = c[key] ?? want;
    let d = want - ang; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    ang += d * 0.2; c[key] = ang;
    const ux = Math.cos(ang), uy = Math.sin(ang), barrel = 15 * dpr;
    ctx.beginPath(); ctx.moveTo(p0.x + ux * barrel, p0.y + uy * barrel); ctx.lineTo(p0.x + ux * barrel * 1.8, p0.y + uy * barrel * 1.8);
    ctx.strokeStyle = tint(c, 0.8, 0.5); ctx.lineWidth = c.width * 1.8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p0.x + ux * barrel, p0.y + uy * barrel);
    ctx.strokeStyle = tint(c, 1.15, 0.35); ctx.lineWidth = c.width * 2.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(p0.x + ux * barrel, p0.y + uy * barrel, c.width * 1.05, 0, 7);
    ctx.fillStyle = tint(c, 0.9, 0.45); ctx.fill();
  }

  // xy crossings between two cords this frame, and which is higher in z there —
  // recomputed every frame from z, so it is always consistent (no bookkeeping)
  function segHit(p0, p1, q0, q1) {
    const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y;
    const den = ux * vy - uy * vx;
    if (Math.abs(den) < 1e-12) return null;
    const wx = q0.x - p0.x, wy = q0.y - p0.y;
    const t = (wx * vy - wy * vx) / den, u = (wx * uy - wy * ux) / den;
    if (t < 0 || t >= 1 || u < 0 || u >= 1) return null;
    return { t, u };
  }

  function draw() {
    step();
    rec.dpr = dpr;
    rec.frames.push([Math.round(mouse.x / dpr), Math.round(mouse.y / dpr)]);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(panel, 0, 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const ends = cables.map((c) => [[c.pts[0], c.pts[2]], [c.pts[N - 1], c.pts[N - 3]]]);
    // cords first (deal order), then seated plugs
    cables.forEach((c) => drawCable(c, c.pts, true, 0));
    cables.forEach((c, i) => {
      if (!heldEnd(c, "a")) drawPlug(c, "a", ends[i][0][0], ends[i][0][1]);
      if (!heldEnd(c, "b")) drawPlug(c, "b", ends[i][1][0], ends[i][1][1]);
    });
    // at every xy crossing, repaint whichever cord is HIGHER in z there, on top
    const patch = (c, x, y, r, i0, i1) => {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
      let arcTo = 0; for (let k = 0; k < i0; k++) arcTo += Math.hypot(c.pts[k + 1].x - c.pts[k].x, c.pts[k + 1].y - c.pts[k].y);
      drawCable(c, c.pts.slice(i0, i1 + 1), true, arcTo);
      ctx.restore();
    };
    for (let a = 0; a < cables.length; a++) for (let b = a + 1; b < cables.length; b++) {
      const A = cables[a], B = cables[b];
      for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
        const hit = segHit(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
        if (!hit) continue;
        const za = A.pts[i].z + (A.pts[i + 1].z - A.pts[i].z) * hit.t;
        const zb = B.pts[j].z + (B.pts[j + 1].z - B.pts[j].z) * hit.u;
        const top = za >= zb ? A : B, ti = za >= zb ? i : j;
        const x = A.pts[i].x + (A.pts[i + 1].x - A.pts[i].x) * hit.t;
        const y = A.pts[i].y + (A.pts[i + 1].y - A.pts[i].y) * hit.t;
        patch(top, x, y, top.width * 1.8, Math.max(0, ti - 2), Math.min(N - 1, ti + 3));
      }
    }
    // the held plug and its lifted cord, above everything
    cables.forEach((c, i) => {
      for (const name of ["a", "b"]) if (heldEnd(c, name)) {
        const e = name === "a" ? ends[i][0] : ends[i][1];
        drawPlug(c, name, e[0], e[1]);
      }
    });
    // the hole the held plug will drop into
    if (drag) {
      const c = drag.cable, p = c.pts[drag.end === "a" ? 0 : N - 1], s = socketNear(c, drag.end, p.x, p.y);
      if (s) {
        ctx.save(); ctx.beginPath(); ctx.arc(s.j.x, s.j.y, JR * 1.2, 0, 7);
        ctx.strokeStyle = tint(c, 1); ctx.globalAlpha = 0.35 + 0.65 * (1 - s.d / SNAP()); ctx.lineWidth = 3 * dpr; ctx.stroke(); ctx.restore();
      }
    }
    // frame counter for lining up recordings
    if (canvas.__lab) {
      ctx.save(); ctx.font = "600 " + 11 * dpr + "px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(120,120,120,0.9)"; ctx.fillText("f " + rec.frames.length, 12 * dpr, h - 12 * dpr); ctx.restore();
    }
    if (!REDUCED) rafId = requestAnimationFrame(draw);
  }

  // ── input ─────────────────────────────────────────────────────────────────
  const GRAB = () => 18 * dpr;
  function plugAt(x, y) {
    for (const c of cables) {
      if (Math.hypot(c.pts[0].x - x, c.pts[0].y - y) < GRAB()) return { cable: c, end: "a" };
      if (Math.hypot(c.pts[N - 1].x - x, c.pts[N - 1].y - y) < GRAB()) return { cable: c, end: "b" };
    }
    return null;
  }
  function liftEnd(c, end) {
    const i = end === "a" ? 0 : N - 1;
    const point = { x: c.pts[i].x, y: c.pts[i].y };
    if (end === "a") { c.a = c.na = point; } else { c.b = c.nb = point; }
    c.move = 1;
  }
  function trySeat() {
    const c = drag.cable, end = drag.end, p = end === "a" ? c.pts[0] : c.pts[N - 1];
    // nothing in range: it goes back to the hole it came from, so a plug is
    // never left floating in the middle of the board
    const best = socketNear(c, end, p.x, p.y)?.j || drag.home;
    // the seat starts where the plug is now, not where it was picked up
    const here = { x: p.x, y: p.y };
    if (end === "a") { c.a = here; c.na = best; } else { c.b = here; c.nb = best; }
    c.moveSpeed = 1 / Math.max(6, Math.min(30, Math.hypot(best.x - p.x, best.y - p.y) / (12 * dpr)));
    c.move = 0;
    drag = null; canvas.style.cursor = "default";
  }

  canvas.addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; if (!drag) canvas.style.cursor = plugAt(mouse.x, mouse.y) ? "grab" : "default"; });
  canvas.addEventListener("pointerdown", (e) => {
    const x = e.clientX * dpr, y = e.clientY * dpr;
    rec.events.push([rec.frames.length, "down", e.clientX, e.clientY]);
    if (drag) { trySeat(); return; }
    const hit = plugAt(x, y); if (!hit) return;
    const home = hit.end === "a" ? hit.cable.na : hit.cable.nb;
    liftEnd(hit.cable, hit.end); drag = { cable: hit.cable, end: hit.end, home };
    mouse.x = x; mouse.y = y; canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", () => { rec.events.push([rec.frames.length, "up", 0, 0]); if (drag) trySeat(); });

  canvas.__pb3d = () => ({ cables, jacks, dpr, N, drag, rec });
  canvas.__lab = false;
  const onKey = (e) => { if (e.key === "r" || e.key === "R") navigator.clipboard?.writeText(JSON.stringify(rec)).then(() => canvas.dispatchEvent(new CustomEvent("patchbay:copied"))); };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", size);
  size();
  draw();
  return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); };
}
