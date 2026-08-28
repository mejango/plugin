// @ts-nocheck — the interactive 2.5D patch bay: a bare board, cords that are
// solid to each other because they have a real height, and plugs that seat in
// holes. Over/under is z; there is no crossing bookkeeping. Drawing is ported
// from the flat engine (the cord and plug look are unchanged); the physics is
// the 3D solver in patchbay3d.ts.

import { collide3, constrainLength3, integrate3, lifted, openFolds3, segClosest3 } from "./patchbay3d";

export const PATCHBAY3D_VERSION = "3d-v33";

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
  const G = 1.6, GZ = 0.04, DAMP = 0.9, LIFT_Z = 26;
  const MAX_STEP = 64;   // device px per frame: 8 per substep, under a cord radius

  function ropeView(c) {
    return { pts: c.pts, prev: c.prev, r: c.r, rest: c.rest,
      heldA: heldEnd(c, "a"), heldB: heldEnd(c, "b"), freeA: !!c.looseA, freeB: !!c.looseB };
  }
  function heldEnd(c, name) {
    return (drag && drag.cable === c && drag.end === name) || (c.move < 1 && (name === "a" ? c.a !== c.na : c.b !== c.nb));
  }
  // an unplugged end: the plug lies loose on the board, hanging from the other
  // end, until the user grabs it and seats it again
  function loose(c, name) { return name === "a" ? c.looseA : c.looseB; }

  // a seated plug is a post: a short vertical cylinder standing off the board.
  // A cord cannot enter its footprint in xy — UNLESS it is riding higher than
  // the post is tall, the same way a cord draped over another rides above it.
  // The post is only about a cord-diameter tall (a connector, not a wall), so a
  // cord that has climbed onto the plug's own cord clears its connector too;
  // only a cord flat on the board is stopped.
  // is c stacked OVER o where they cross (the pair's held order in `stick`)?
  // Cords the dragged one was NOT touching when it was picked up. You lifted it
  // clear of them, so for this whole drag it rides OVER them: they never block
  // it, and it can never pull their plugs. Only what it was already tangled with
  // can catch it. (`stick` holds an entry exactly while a pair is in contact.)
  let clearOf = new Set();
  function over(c, o) {
    // both directions, or the other cord still walls the dragged one and pulls
    // its plug out through the cord path
    if (drag && drag.cable === c && clearOf.has(o)) return true;
    if (drag && drag.cable === o && clearOf.has(c)) return false;
    const ci = cables.indexOf(c), oi = cables.indexOf(o);
    return ci < oi ? stick.get(ci + "," + oi) === 1 : stick.get(oi + "," + ci) === -1;
  }
  function offPosts(c) {
    const BARREL = 15 * dpr, R = BARREL + c.r;
    const POST_H = c.r * 1.2;   // a connector ~a cord-diameter tall; a cord stacked one diameter up (z≈2·r) clears it
    const view = ropeView(c);
    for (const o of cables) {
      const riding = o !== c && over(c, o);   // riding over that cord: nothing of it touches us...
      for (const name of ["a", "b"]) {
        if (heldEnd(o, name) || loose(o, name)) continue;
        // ...but a cord WOUND AROUND a connector is around it whoever is on top.
        // A plug is a post standing off the board: you cannot lift a loop off it
        // by riding over the cord. Without this the stack order flipping mid-wrap
        // made the plug vanish and the loop slipped straight over it in a frame.
        const jack = o.pts[name === "a" ? 0 : N - 1];
        if (riding && !(o[name === "a" ? "wrapA" : "wrapB"])) continue;
        // the post is a CAPSULE from the jack out to the collar, so a cord is
        // blocked everywhere around the connector — including the gap right at
        // the hole, which a single circle further out left open (a cord slipped
        // BETWEEN the endcap and the jack).
        const e = name === "a" ? o.pts[0] : o.pts[N - 1];
        const nx = name === "a" ? o.pts[1] : o.pts[N - 2];
        const ux = nx.x - e.x, uy = nx.y - e.y, ul = Math.hypot(ux, uy) || 1;
        // the capsule runs from the jack past the collar to the cord's first point:
        // the cable leaves the plug's tip, so nothing slides off that end
        const ex = e.x, ey = e.y, fx = e.x + (ux / ul) * Math.max(BARREL, ul), fy = e.y + (uy / ul) * Math.max(BARREL, ul);
        const vx = fx - ex, vy = fy - ey, vv = vx * vx + vy * vy || 1;
        for (let i = 1; i < N - 1; i++) {
          if (o === c && (i <= 1 || i >= N - 2)) continue;   // a cord's own plug
          if (lifted(view, i)) continue;
          const p = c.pts[i];
          if (p.z > e.z + POST_H) continue;                  // riding over the connector

          let t = Math.max(0, Math.min(1, ((p.x - ex) * vx + (p.y - ey) * vy) / vv));
          // a cord caught on this plug doesn't slide off along it toward the
          // cable (collar flare, friction): it may slip back toward the jack, not on
          // hooked on THIS plug: the whole cord is confined to the side it
          // caught on (one pinned point is not enough — its neighbours swing
          // around the jack end and drag the cord through), and the caught
          // point itself cannot slide off along the barrel toward the cable.
          // ...the points that FORM the hook, not the whole cord: a distant
          // stretch may legitimately lie on the far side of this plug, and
          // slamming it across teleports the cord and breaks the hook.
          const onThisPlug = catchAt && catchAt.post && catchAt.o === o && catchAt.end === name && Math.abs(i - catchAt.i) <= 3;
          const hookedHere = onThisPlug && catchAt.i === i;
          if (hookedHere) t = Math.min(t, catchAt.t);
          const gx = ex + vx * t, gy = ey + vy * t;
          let dx = p.x - gx, dy = p.y - gy;
          // A plug you are hooked on is SOLID: you cannot swing around its jack
          // end to the far side — that was the escape that let a cord wriggle
          // free instead of ever pulling the plug out. Only retreat frees it.
          if (onThisPlug && Math.sign(vx * dy - vy * dx) !== catchAt.side) {
            const vl = Math.hypot(vx, vy) || 1;
            dx = (-vy / vl) * catchAt.side; dy = (vx / vl) * catchAt.side;
            // it tried to go THROUGH the plug. That is the tug: the alternative
            // to letting it tunnel is the plug coming out.
            if (hooked(c, i)) o[name === "a" ? "pressA" : "pressB"] = true;
          }
          const d = Math.hypot(dx, dy);
          if (d < R && d > 1e-6) {
            // a cord wrapped around this connector and TUGGED (dragged so hard
            // it sinks a cord-radius into the post): rather than let it tunnel,
            // the tug pulls the plug out of its hole. The unplugged end goes
            // loose and hangs from its other end until the user seats it again.
            // a TUG is tension, not a brush: the cord pressing into the post
            // while pulled straight on both sides of it. A loose wrap that
            // merely passes by is slack somewhere.
            if (drag && drag.cable === c && o !== c && d < R - c.r * 0.5 && hooked(c, i)) { caught(c, i, o, name, true); if (catchAt.t === undefined) { catchAt.t = t; catchAt.side = Math.sign(vx * (p.y - gy) - vy * (p.x - gx)) || 1; }
              if (straining(c)) o[name === "a" ? "pressA" : "pressB"] = true; }
            p.x = gx + (dx / d) * R; p.y = gy + (dy / d) * R;
          }
        }
      }
    }
  }

  // straight-line span over arc length between two points of a cord: 1 = taut
  // (the caller skips a window around the wrap itself, which is a loop by nature)
  function taut(c, i0, i1) {
    i0 = Math.max(0, Math.min(N - 1, i0)); i1 = Math.max(0, Math.min(N - 1, i1));
    if (i1 <= i0) return true;   // nothing left to be slack
    let arc = 0;
    for (let k = i0; k < i1; k++) arc += Math.hypot(c.pts[k + 1].x - c.pts[k].x, c.pts[k + 1].y - c.pts[k].y);
    return Math.hypot(c.pts[i1].x - c.pts[i0].x, c.pts[i1].y - c.pts[i0].y) > 0.85 * arc;
  }
  // taut from the contact at i out to one end of the dragged cord (the two
  // points either side of the contact are the bend itself, so they are skipped)
  function tautTo(c, i) {
    const e = drag.end === "a" ? 0 : N - 1;
    return taut(c, Math.min(e, i) + (e < i ? 0 : 2), Math.max(e, i) - (e < i ? 2 : 0));
  }
  // is the dragged cord HOOKED on whatever it touches at point i? Not the hand
  // itself walking into it (i near either end), the hand is pulling taut on its
  // side, and the cord is bent around the contact — the arms to the hand and to
  // the far end less than 120 degrees apart. This is what CATCHES: the hand is
  // held, and the pull then takes up whatever slack is left down the far side.
  function hooked(c, i) {
    const hi = drag.end === "a" ? 0 : N - 1, fi = N - 1 - hi;
    if (Math.abs(i - hi) < 3 || Math.abs(i - fi) < 2) return false;
    if (!tautTo(c, i)) return false;
    const p = c.pts[i], h = c.pts[hi], f = c.pts[fi];
    const ax = h.x - p.x, ay = h.y - p.y, bx = f.x - p.x, by = f.y - p.y;
    return (ax * bx + ay * by) / ((Math.hypot(ax, ay) || 1) * (Math.hypot(bx, by) || 1)) > -0.5;
  }

  // the dragged cord is hooked at point i: remember where, and how much cord
  // is left between there and the hand, so the hand can be held to it
  let catchAt = null, catchSeen = false;   // { x, y, rem }: carried frame to frame while the catch keeps being felt
  // How much cord is left between the catch and the hand: what a cord this taut
  // has, minus the straight run from the far end to the catch. Straight, not the
  // current arc — the far side is under tension and pulls straight; measuring its
  // slack arc would clamp the hand too short to ever pull that slack out (a
  // deadlock: no pull, no take-up, never taut, never a tug). Recomputed every
  // frame, so the hand advances as the slack comes out and stops when it is gone.
  // TAUT is 0.95, not 1: a real cord keeps a little give, and a wrap pulled to
  // 95% of its length is straining hard — demanding 100% meant never tugging.
  const TAUT = 0.95;
  function catchRem(c) {
    const f = c.pts[drag.end === "a" ? N - 1 : 0];
    return Math.max(0, c.len * TAUT - Math.hypot(f.x - catchAt.x, f.y - catchAt.y));
  }
  // the mouse is asking for more cord than is left around the hook: that is the strain
  // Sticky, because the hook point slides a little every frame and the reach
  // moves with it: without hysteresis the strain flickers on and off and the
  // tug counter decays faster than it builds.
  let strainOn = false;
  function straining(c) {
    if (!catchAt) return (strainOn = false);
    const d = Math.hypot(mouse.x - catchAt.x, mouse.y - catchAt.y), rem = catchRem(c);
    strainOn = strainOn ? d > rem - 6 * c.r : d > rem;
    return strainOn;
  }
  // how far the dragged cord winds around a point, in radians — a cord merely
  // passing by turns through very little, a hook about half a turn, a loop a
  // whole one. This, not proximity, is what says a cord is still ON a plug: a
  // wide loop is far from the plug and still very much around it.
  function windAbout(c, e) {
    let w = 0;
    for (let i = 0; i < N - 1; i++) {
      const a0 = Math.atan2(c.pts[i].y - e.y, c.pts[i].x - e.x);
      let d = Math.atan2(c.pts[i + 1].y - e.y, c.pts[i + 1].x - e.x) - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      w += d;
    }
    return Math.abs(w);
  }
  function caught(c, i, o, end, post) {
    catchSeen = true;
    // Already caught here: keep the side and slide it caught with (those hold
    // the hook), but let WHERE track the cord — a frozen point index goes stale
    // as the cord slides around the plug, and then the catch drops and it slips.
    if (catchAt && catchAt.o === o && catchAt.end === end) { catchAt.x = c.pts[i].x; catchAt.y = c.pts[i].y; catchAt.i = i; return; }
    const ci = cables.indexOf(c), oi = cables.indexOf(o), key = Math.min(ci, oi) + "," + Math.max(ci, oi);
    catchAt = { x: c.pts[i].x, y: c.pts[i].y, key, order: stick.get(key), o, end, post, i };
  }
  function endDrag() { drag = null; clearOf = new Set(); }
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
          // A cord has a fixed length: its free end can only reach a circle of
          // that length around the end that stays plugged in. Clamp the aim to
          // that circle so the hand cannot stretch the cord — past full reach
          // the plug just stops, taut, instead of following the cursor. (The
          // held plug rides at LIFT_Z above the board, so the flat reach is the
          // leg of that right triangle.)
          const far = c.pts[name === "a" ? N - 1 : 0];
          const maxR = Math.sqrt(Math.max(0, c.len * c.len - LIFT_Z * LIFT_Z));
          let mx = mouse.x, my = mouse.y;
          const rx = mx - far.x, ry = my - far.y, rd = Math.hypot(rx, ry);
          // (a loose far end is no anchor — it is carried along, so no clamp)
          if (!loose(c, name === "a" ? "b" : "a") && rd > maxR && rd > 1e-6) { mx = far.x + (rx / rd) * maxR; my = far.y + (ry / rd) * maxR; }
          // CAUGHT on something: the hand is held to the cord left past the
          // catch (a hair over, so it keeps pulling and the tug keeps counting)
          if (catchAt) {
            const cx = mx - catchAt.x, cy = my - catchAt.y, cd = Math.hypot(cx, cy), lim = catchRem(c) + 3 * dpr;
            if (cd > lim && cd > 1e-6) { mx = catchAt.x + (cx / cd) * lim; my = catchAt.y + (cy / cd) * lim; }
          }
          // BOUNDED: the held plug advances at most MAX_STEP a frame, so each
          // substep is under a cord radius. Otherwise a flick moves a point
          // ~20px per substep and jumps clean over a plug's capsule — which is
          // a position test, not a swept one — and the catch loses its grip.
          const fr = from[name] || { x: mx, y: my, z: LIFT_Z };
          const sx = mx - fr.x, sy = my - fr.y, sd = Math.hypot(sx, sy);
          if (sd > MAX_STEP) { mx = fr.x + (sx / sd) * MAX_STEP; my = fr.y + (sy / sd) * MAX_STEP; }
          p.x = fr.x + (mx - fr.x) * f; p.y = fr.y + (my - fr.y) * f; p.z = LIFT_Z;
        } else if (loose(c, name)) {
          // unplugged: a free point the solver owns (freeA/freeB); it drops and hangs
          p.z = 0;
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
    const FOLD_COS = Math.cos((50 * Math.PI) / 180);   // a stiff cord: no sharper than 50 degrees
    // An under-cord cannot be slid THROUGH the body of a cord it is caught
    // under: its travel this substep is swept against the over-cord's segments
    // and stopped a radius short — it piles up against it like a wall, and
    // comes free only around the over-cord's end. Pushed taut into that wall,
    // it tugs the over-cord's nearest plug out (then the over-cord yields).
    const segT = (p0, p1, q0, q1) => {
      const rx = p1.x - p0.x, ry = p1.y - p0.y, sx = q1.x - q0.x, sy = q1.y - q0.y;
      const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) return -1;
      const wx = q0.x - p0.x, wy = q0.y - p0.y;
      const t = (wx * sy - wy * sx) / den, u = (wx * ry - wy * rx) / den;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
    };
    // every seated plug the dragged cord is wound around this frame
    // Sticky: a wrap is declared at more than a wide half-turn and released
    // only well below it. A loop that slides off the plug ALONG the cord is
    // still linked — winding about the jack falls, but the cord is not free —
    // so releasing on the same threshold let the loop leak away in one frame.
    const wrapped = [];
    for (const A of cables) for (const end of ["a", "b"]) {
      const k = end === "a" ? "wrapA" : "wrapB";
      if (!drag || A === drag.cable || heldEnd(A, end) || loose(A, end) || clearOf.has(A)) { A[k] = false; continue; }
      const w = windAbout(drag.cable, A.pts[end === "a" ? 0 : N - 1]);
      // A wrap is declared either by winding — above PI, always, since a cord
      // running straight past a point subtends up to a half turn — or by a hook
      // caught on this very plug (contact, taut, bent around it), which is how a
      // shallow U round a post counts without a straight pass ever doing so.
      const hookedOn = catchAt && catchAt.post && catchAt.o === A && catchAt.end === end;
      A[k] = hookedOn || (A[k] ? w > 0.8 : w > 3.4);
      if (A[k]) wrapped.push({ A, end });
    }
    const wall = (snap) => {
      if (!drag) return;
      const B = drag.cable;
      // A loop around a seated plug cannot slide off its tip — the plug is
      // anchored in the board, so the loop comes off only when the plug does.
      // The one way to unwind is across the ray running out of the jack away
      // from the cord; bar it, and every attempt is a tug on that plug.
      // Driven by the WINDING, not by a catch: a catch needs contact and a
      // particular pose, and flickers, while a loop is a loop — a placed one
      // used to unwind and slide off in a few frames with no pull at all.
      for (const wp of wrapped) {
        const A = wp.A, aEnd = wp.end === "a" ? 0 : N - 1, aNext = wp.end === "a" ? 1 : N - 2;
        const e = A.pts[aEnd], nb = A.pts[aNext];
        const ux = e.x - nb.x, uy = e.y - nb.y, ul = Math.hypot(ux, uy) || 1;
        // The bar spans the whole plug: from far outside the jack (a loop
        // cannot unwind off that tip at ANY distance) to just past the collar,
        // the plug's other end. Crossing anywhere on it is passing through the
        // plug — off the jack end, or off the collar end across the cord.
        const out = 300 * dpr, into = 15 * dpr + 2 * B.r;
        const q0 = { x: e.x + (ux / ul) * out, y: e.y + (uy / ul) * out };
        const q1 = { x: e.x - (ux / ul) * into, y: e.y - (uy / ul) * into };
        // every point, not just the hook: the cord unwinds from whichever side
        // is free, and a window around the hook leaves the other side open
        for (let i = 0; i < N; i++) {
          const p = B.pts[i], p0 = snap[i];
          const mlen = Math.hypot(p.x - p0.x, p.y - p0.y); if (mlen < 1e-6) continue;
          const t = segT(p0, p, q0, q1);
          if (t < 0) continue;
          const back = Math.max(0, t - B.r / mlen);
          p.x = p0.x + (p.x - p0.x) * back; p.y = p0.y + (p.y - p0.y) * back;
          A[wp.end === "a" ? "pressA" : "pressB"] = true;
        }
      }
      for (const A of cables) {
        if (A === B || !over(A, B) || A.looseA || A.looseB) continue;
        const reach = B.r + A.r;
        for (let i = 0; i < N; i++) {
          const p = B.pts[i], p0 = snap[i];
          const mlen = Math.hypot(p.x - p0.x, p.y - p0.y); if (mlen < 1e-6) continue;
          let best = -1, bj = -1;
          for (let j = 0; j < N - 1; j++) {
            const t = segT(p0, p, A.pts[j], A.pts[j + 1]);
            if (t >= 0 && (best < 0 || t < best)) { best = t; bj = j; }
          }
          if (best < 0) continue;
          // may go negative: the point RETREATS to a full radius off the line, so a
          // settling over-cord can't drift across a point parked right on it
          const back = best - reach / mlen;
          p.x = p0.x + (p.x - p0.x) * back; p.y = p0.y + (p.y - p0.y) * back;
          if (hooked(B, i) && !clearOf.has(A)) {
            const h = A.pts[bj];
            const dA = Math.hypot(h.x - A.pts[0].x, h.y - A.pts[0].y), dB = Math.hypot(h.x - A.pts[N - 1].x, h.y - A.pts[N - 1].y);
            const end = dA < dB ? "a" : "b";
            caught(B, i, A, end);
            // A blocked crossing alone is not a tug — a cord shoved sideways
            // against another is blocked every frame and must not pull its plug.
            // The hand has to be straining against the hook.
            if (straining(B)) A[end === "a" ? "pressA" : "pressB"] = true;
          }
        }
      }
    };
    for (let s = 1; s <= SUB; s++) {
      // snapshot BEFORE the solver: the length solve drags body points too
      const snap = drag ? drag.cable.pts.map((q) => ({ x: q.x, y: q.y })) : null;
      for (const c of cables) constrainLength3(ropeView(c), 16);
      for (const c of cables) openFolds3(ropeView(c), FOLD_COS, 0.5);
      pin(s / SUB);
      for (const c of cables) offPosts(c);
      drape();
      collide3(ropes, 2, stick);
      // a caught pair stays engaged: the hooked cord is held a radius off the
      // other, which the release band would otherwise read as "apart"
      if (catchAt && catchAt.order) stick.set(catchAt.key, catchAt.order);
      pin(s / SUB);
      if (snap) wall(snap);
    }
    // taut pressure on a connector pulls its plug out
    // The catch persists while the hand keeps pulling past it and the catch
    // point is still against the other cord — it does not need a fresh hit
    // every frame (once the hand is held, nothing tries to cross any more).
    // Each such frame is a frame of tug on that cord's end.
    if (drag && wrapped.length && !(catchAt && catchAt.post)) {
      const B = drag.cable, w = wrapped[0], jack = w.A.pts[w.end === "a" ? 0 : N - 1];
      let bi = 1, bd = Infinity;
      for (let i = 1; i < N - 1; i++) { const d = Math.hypot(B.pts[i].x - jack.x, B.pts[i].y - jack.y); if (d < bd) { bd = d; bi = i; } }
      caught(B, bi, w.A, w.end, true);
    }
    if (catchAt && drag && clearOf.has(catchAt.o)) { catchAt = null; catchSeen = false; }
    if (catchAt && drag) {
      const B = drag.cable, o = catchAt.o;
      // Still hooked? Measure the cord where it actually IS now, never the
      // frozen catch point — that point sits by the plug for ever, and reading
      // it kept a catch alive (and tugging) long after the cord had slipped free.
      const j0 = catchAt.post ? (catchAt.end === "a" ? 0 : N - 2) : 0, j1 = catchAt.post ? j0 + 1 : N - 1;
      let near = Infinity;
      for (let i = Math.max(1, catchAt.i - 4); i <= Math.min(N - 2, catchAt.i + 4); i++) {
        const p = B.pts[i];
        for (let j = j0; j < j1; j++) { const q0 = o.pts[j], q1 = o.pts[j + 1]; const vx = q1.x - q0.x, vy = q1.y - q0.y, vv = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, ((p.x - q0.x) * vx + (p.y - q0.y) * vy) / vv));
          near = Math.min(near, Math.hypot(p.x - q0.x - vx * t, p.y - q0.y - vy * t)); }
      }
      // Still hooked: keep the catch (and so the hand clamp) alive, and count a
      // frame of tug for every frame the hand is straining against it. Counting
      // only on a fresh collision does not work — once the hand is clamped the
      // cord is held just clear of the post, so contact recurs only now and then
      // and the counter decays back down between hits.
      const wound = catchAt.post && !!o[catchAt.end === "a" ? "wrapA" : "wrapB"];
      if (wound || near < (catchAt.post ? 15 * dpr : 0) + 3 * B.r) {
        catchSeen = true;
        // WRAPPED round the plug and the hand cannot get to the mouse: that IS
        // the tug, and it is smooth — counting discrete resistance events
        // instead is intermittent, and the counter decays between them faster
        // than they arrive. Merely hooked (touching, bent) is not enough: a cord
        // shoved sideways against another is blocked every frame too, and must
        // not pull a plug. That one has to be a straining, taut pull.
        const h = B.pts[drag.end === "a" ? 0 : N - 1];
        const held = Math.hypot(h.x - mouse.x, h.y - mouse.y) > 4 * B.r;
        if ((wound && held) || straining(B)) o[catchAt.end === "a" ? "pressA" : "pressB"] = true;
      }
    }
    for (const c of cables) for (const name of ["a", "b"]) {
      const k = name === "a" ? "pressA" : "pressB", t = name === "a" ? "tugA" : "tugB";
      c[t] = c[k] ? (c[t] || 0) + 1 : Math.max(0, (c[t] || 0) - 2); c[k] = false;
      // held caught for ~0.4s of steady pull, then the plug lets go
      if (c[t] > 25 && !loose(c, name)) { unplug(c, name); c[t] = 0; if (catchAt && catchAt.o === c) { catchAt = null; catchSeen = false; } }   // it gave: the hand lets go
    }
    if (!catchSeen) catchAt = null; catchSeen = false;
    for (const c of cables) if (c.move < 1) { c.move = Math.min(1, c.move + (c.moveSpeed || 0.05)); if (c.move >= 1) { c.a = c.na; c.b = c.nb; } }
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
    if (end === "a") { c.a = c.na = point; c.looseA = false; } else { c.b = c.nb = point; c.looseB = false; }
    c.move = 1;
  }
  function unplug(c, end) {
    liftEnd(c, end);
    const i = end === "a" ? 0 : N - 1;   // it was pinned: no history, so no launch — it just drops
    c.prev[i].x = c.pts[i].x; c.prev[i].y = c.pts[i].y; c.prev[i].z = c.pts[i].z;
    if (end === "a") c.looseA = true; else c.looseB = true;
  }
  function trySeat() {
    const c = drag.cable, end = drag.end, p = end === "a" ? c.pts[0] : c.pts[N - 1];
    const far = end === "a" ? c.pts[N - 1] : c.pts[0];
    let best = null, bd = 44 * dpr;
    for (const j of jacks) {
      if (jackTaken(j)) continue;
      if (Math.hypot(j.x - far.x, j.y - far.y) > c.len) continue;   // hole is out of the cord's reach
      const d = Math.hypot(j.x - p.x, j.y - p.y); if (d < bd) { bd = d; best = j; }
    }
    if (!best) return;
    // Anchor the seat animation at where the plug IS right now, not where the
    // cord was first grabbed — otherwise the plug snaps back across the board
    // to the grab point and the cord explodes on release.
    const here = { x: p.x, y: p.y };
    if (end === "a") { c.a = here; c.na = best; } else { c.b = here; c.nb = best; }
    c.moveSpeed = 0.1; c.move = 0;
    endDrag(); canvas.style.cursor = "default";
  }

  canvas.addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; if (!drag) canvas.style.cursor = plugAt(mouse.x, mouse.y) ? "grab" : "default"; });
  canvas.addEventListener("pointerdown", (e) => {
    const x = e.clientX * dpr, y = e.clientY * dpr;
    rec.events.push([rec.frames.length, "down", e.clientX, e.clientY]);
    if (drag) { trySeat(); return; }
    const hit = plugAt(x, y); if (!hit) return;
    liftEnd(hit.cable, hit.end); drag = { cable: hit.cable, end: hit.end };
    clearOf = new Set(cables.filter((o) => {
      if (o === hit.cable) return false;
      const ci = cables.indexOf(hit.cable), oi = cables.indexOf(o);
      return !stick.has(Math.min(ci, oi) + "," + Math.max(ci, oi));
    }));
    mouse.x = x; mouse.y = y; canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", () => { rec.events.push([rec.frames.length, "up", 0, 0]); if (drag) trySeat(); });

  canvas.__pb3d = () => ({ cables, jacks, dpr, N, drag, rec, stick, catchAt });   // NOTE: drag/catchAt are captured BY VALUE — refetch each frame
  if (canvas.__lab == null) canvas.__lab = false;   // the lab page sets it true before us; don't clobber
  const onKey = (e) => { if (e.key === "r" || e.key === "R") navigator.clipboard?.writeText(JSON.stringify(rec)).then(() => canvas.dispatchEvent(new CustomEvent("patchbay:copied"))); };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", size);
  size();
  draw();
  return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); };
}
