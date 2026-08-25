// @ts-nocheck — the interactive 2.5D patch bay: a bare board, cords that are
// solid to each other because they have a real height, and plugs that seat in
// holes. Over/under is z; there is no crossing bookkeeping. Drawing is ported
// from the flat engine (the cord and plug look are unchanged); the physics is
// the 3D solver in patchbay3d.ts.

import { collide3, constrainLength3, integrate3, lifted, openFolds3, segClosest3 } from "./patchbay3d";

export const PATCHBAY3D_VERSION = "3d-v10";

export function startPatchBay3D(canvas: HTMLCanvasElement, opts: { cables?: number } = {}): () => void {
  const ctx = canvas.getContext("2d");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 16;
  let w, h, dpr, jacks = [], cables = [], panel, JR = 0, rafId = 0;
  const mouse = { x: -1e9, y: -1e9 };
  let drag = null;                    // { cable, end: "a"|"b" }
  const stick = new Map();            // who is on top, per cord pair; held while in contact
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
    if (!cables.length) deal(gap);
    else for (const c of cables) reproject(c);
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
    for (let i = 0; i < 240; i++) step();
  }

  // ── physics ──────────────────────────────────────────────────────────────
  const G = 2.3, GZ = 0.04, DAMP = 0.992, LIFT_Z = 26;

  function ropeView(c) {
    return { pts: c.pts, prev: c.prev, r: c.r, rest: c.rest,
      heldA: heldEnd(c, "a"), heldB: heldEnd(c, "b") };
  }
  function heldEnd(c, name) {
    return (drag && drag.cable === c && drag.end === name) || (c.move < 1 && (name === "a" ? c.a !== c.na : c.b !== c.nb));
  }

  // a seated plug is a post: a solid vertical cylinder standing off the board.
  // A cord cannot enter its footprint in xy (unless the cord is lifted over it).
  function offPosts(c) {
    const BARREL = 15 * dpr, R = BARREL + c.r;
    const view = ropeView(c);
    for (const o of cables) {
      for (const name of ["a", "b"]) {
        if (heldEnd(o, name)) continue;
        // the post is a CAPSULE from the jack out to the collar, so a cord is
        // blocked everywhere around the connector — including the gap right at
        // the hole, which a single circle further out left open (a cord slipped
        // BETWEEN the endcap and the jack).
        const e = name === "a" ? o.pts[0] : o.pts[N - 1];
        const nx = name === "a" ? o.pts[1] : o.pts[N - 2];
        const ux = nx.x - e.x, uy = nx.y - e.y, ul = Math.hypot(ux, uy) || 1;
        const ex = e.x, ey = e.y, fx = e.x + (ux / ul) * BARREL, fy = e.y + (uy / ul) * BARREL;
        const vx = fx - ex, vy = fy - ey, vv = vx * vx + vy * vy || 1;
        for (let i = 1; i < N - 1; i++) {
          if (o === c && (i <= 1 || i >= N - 2)) continue;   // a cord's own plug
          if (lifted(view, i)) continue;
          const p = c.pts[i];
          const t = Math.max(0, Math.min(1, ((p.x - ex) * vx + (p.y - ey) * vy) / vv));
          const gx = ex + vx * t, gy = ey + vy * t;
          const dx = p.x - gx, dy = p.y - gy, d = Math.hypot(dx, dy);
          if (d < R && d > 1e-6) { p.x = gx + (dx / d) * R; p.y = gy + (dy / d) * R; }
        }
      }
    }
  }

  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }

  function step() {
    // where each held plug is coming from, this frame, so we can interpolate it
    // across sub-frames (nothing leaps far enough to jump a cord)
    const from = {};
    for (const c of cables) for (const [name, idx] of [["a", 0], ["b", N - 1]]) {
      if (drag && drag.cable === c && drag.end === name) from[name] = { x: c.pts[idx].x, y: c.pts[idx].y, z: c.pts[idx].z };
    }
    const ropes = cables.map(ropeView);
    const pin = (f) => {
      for (const c of cables) for (const [name, idx] of [["a", 0], ["b", N - 1]]) {
        const p = c.pts[idx];
        if (drag && drag.cable === c && drag.end === name) {
          const fr = from[name] || { x: mouse.x, y: mouse.y, z: LIFT_Z };
          p.x = fr.x + (mouse.x - fr.x) * f; p.y = fr.y + (mouse.y - fr.y) * f; p.z = LIFT_Z;
        } else if (c.move < 1) {
          const k = ease(c.move);
          const src = name === "a" ? c.a : c.b, dst = name === "a" ? c.na : c.nb;
          p.x = src.x + (dst.x - src.x) * k; p.y = src.y + (dst.y - src.y) * k; p.z = LIFT_Z * (1 - k);
        } else {
          const j = name === "a" ? c.a : c.b; p.x = j.x; p.y = j.y; p.z = 0;
        }
      }
    };
    // Integrate ONCE per frame — velocity and gravity are applied consistently
    // whether or not a cord is being dragged, so a free cord never jumps when
    // the substep count changes. Only the constraint solve is substepped, with
    // the held plug interpolated across it so the body never leaps a cord.
    for (const c of cables) integrate3(ropeView(c), G * dpr, GZ, DAMP);
    // The dragged cord DRAPES from the hand down to the board — but as a soft
    // pull, not a command. Where it runs UNDER another cord, collision (run
    // last) pushes it back down and it stays caught; away from that the drape
    // lifts it and it rides over. So a caught cord is never teleported over —
    // you must pull it free.
    const drape = () => {
      if (!drag) return;
      const c = drag.cable, n = c.pts.length;
      for (let k = 1; k < n - 1; k++) {
        const d = drag.end === "a" ? k : n - 1 - k;
        const want = LIFT_Z * Math.max(0, 1 - d / 5);
        c.pts[k].z += (want - c.pts[k].z) * 0.25;
      }
    };
    const SUB = 8;
    const FOLD_COS = Math.cos((70 * Math.PI) / 180);   // no sharper than 70 degrees
    for (let s = 1; s <= SUB; s++) {
      for (const c of cables) constrainLength3(ropeView(c), 3);
      for (const c of cables) openFolds3(ropeView(c), FOLD_COS, 0.3);
      pin(s / SUB);
      for (const c of cables) offPosts(c);
      drape();
      collide3(ropes, 2, stick);
      pin(s / SUB);
    }
    for (const c of cables) if (c.move < 1) c.move = Math.min(1, c.move + (c.moveSpeed || 0.05));
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
  function drawPlug(c, p0, p1) {
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len, barrel = 15 * dpr;
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

    const ends = cables.map((c) => [[c.pts[0], c.pts[1]], [c.pts[N - 1], c.pts[N - 2]]]);
    // cords first (deal order), then seated plugs
    cables.forEach((c) => drawCable(c, c.pts, true, 0));
    cables.forEach((c, i) => {
      if (!heldEnd(c, "a")) drawPlug(c, ends[i][0][0], ends[i][0][1]);
      if (!heldEnd(c, "b")) drawPlug(c, ends[i][1][0], ends[i][1][1]);
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
        drawPlug(c, e[0], e[1]);
      }
    });
    // debug overlay (lab only): when an end is grabbed, show what physics says.
    // The grabbed cord is cyan. Any cord that currently sits ABOVE it where they
    // cross is magenta — those are what it cannot climb over. The seated ends of
    // those over-cords are ringed amber: each is an impasse, an anchor that pins
    // a cord down across the grabbed one, so the grabbed end cannot pass it.
    if (canvas.__lab && drag) {
      const G = drag.cable;
      const above = new Set();
      for (const C of cables) {
        if (C === G) continue;
        for (let i = 0; i < N - 1 && !above.has(C); i++) for (let j = 0; j < N - 1; j++) {
          const hit = segHit(G.pts[i], G.pts[i + 1], C.pts[j], C.pts[j + 1]);
          if (!hit) continue;
          const zg = G.pts[i].z + (G.pts[i + 1].z - G.pts[i].z) * hit.t;
          const zc = C.pts[j].z + (C.pts[j + 1].z - C.pts[j].z) * hit.u;
          if (zc > zg) { above.add(C); break; }
        }
      }
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const glow = (c, col) => {
        ctx.globalAlpha = 0.35; ropePath(c.pts, 0); ctx.strokeStyle = col; ctx.lineWidth = c.width * 3.4; ctx.stroke();
        ctx.globalAlpha = 0.95; ropePath(c.pts, 0); ctx.strokeStyle = col; ctx.lineWidth = c.width * 0.7; ctx.stroke();
      };
      glow(G, "rgb(0,190,255)");
      for (const C of above) glow(C, "rgb(255,45,130)");
      ctx.globalAlpha = 1;
      for (const C of above) for (const e of [C.pts[0], C.pts[N - 1]]) {
        ctx.beginPath(); ctx.arc(e.x, e.y, C.width * 2.3, 0, 7);
        ctx.fillStyle = "rgba(255,200,0,0.18)"; ctx.fill();
        ctx.strokeStyle = "rgb(255,200,0)"; ctx.lineWidth = 3 * dpr; ctx.stroke();
        ctx.beginPath(); ctx.arc(e.x, e.y, C.width * 2.3 + 5 * dpr, 0, 7);
        ctx.strokeStyle = "rgba(255,200,0,0.4)"; ctx.lineWidth = 2 * dpr; ctx.stroke();
      }
      ctx.restore();
    }
    // frame counter for lining up recordings
    if (canvas.__lab) {
      ctx.save(); ctx.font = "600 " + 11 * dpr + "px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(120,120,120,0.9)"; ctx.fillText("f " + rec.frames.length, 12 * dpr, h - 12 * dpr);
      const leg = [["grabbed", "rgb(0,190,255)"], ["above", "rgb(255,45,130)"], ["impasse", "rgb(255,200,0)"]];
      let lx = 12 * dpr; const ly = h - 30 * dpr;
      for (const [t, col] of leg) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx + 5 * dpr, ly - 4 * dpr, 5 * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(120,120,120,0.9)"; ctx.fillText(t, lx + 14 * dpr, ly);
        lx += (14 + t.length * 7 + 14) * dpr;
      }
      ctx.restore();
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
    let best = null, bd = 44 * dpr;
    for (const j of jacks) { if (jackTaken(j)) continue; const d = Math.hypot(j.x - p.x, j.y - p.y); if (d < bd) { bd = d; best = j; } }
    if (!best) return;
    // Anchor the seat animation at where the plug IS right now, not where the
    // cord was first grabbed — otherwise the plug snaps back across the board
    // to the grab point and the cord explodes on release.
    const here = { x: p.x, y: p.y };
    if (end === "a") { c.a = here; c.na = best; } else { c.b = here; c.nb = best; }
    c.moveSpeed = 0.1; c.move = 0;
    drag = null; canvas.style.cursor = "default";
  }

  canvas.addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; if (!drag) canvas.style.cursor = plugAt(mouse.x, mouse.y) ? "grab" : "default"; });
  canvas.addEventListener("pointerdown", (e) => {
    const x = e.clientX * dpr, y = e.clientY * dpr;
    rec.events.push([rec.frames.length, "down", e.clientX, e.clientY]);
    if (drag) { trySeat(); return; }
    const hit = plugAt(x, y); if (!hit) return;
    liftEnd(hit.cable, hit.end); drag = { cable: hit.cable, end: hit.end };
    mouse.x = x; mouse.y = y; canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", () => { rec.events.push([rec.frames.length, "up", 0, 0]); if (drag) trySeat(); });

  canvas.__pb3d = () => ({ cables, jacks, dpr, N, drag, rec });
  if (canvas.__lab == null) canvas.__lab = false;   // the lab page sets it true before us; don't clobber
  const onKey = (e) => { if (e.key === "r" || e.key === "R") navigator.clipboard?.writeText(JSON.stringify(rec)).then(() => canvas.dispatchEvent(new CustomEvent("patchbay:copied"))); };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", size);
  size();
  draw();
  return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); };
}
