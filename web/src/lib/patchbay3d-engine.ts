// @ts-nocheck — the interactive 2.5D patch bay: a bare board, cords that are
// solid to each other because they have a real height, and plugs that seat in
// holes. Over/under is z; there is no crossing bookkeeping. Drawing is ported
// from the flat engine (the cord and plug look are unchanged); the physics is
// the 3D solver in patchbay3d.ts.

import { bend3, collide3, constrainLength3, integrate3, offPost3, unkink3 } from "./patchbay3d";

export const PATCHBAY3D_VERSION = "bare-v4";

export function startPatchBay3D(canvas: HTMLCanvasElement, opts: { cables?: number } = {}): () => void {
  const ctx = canvas.getContext("2d");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 30;   // enough segments that a dragged cord curls instead of kinking
  let w, h, dpr, jacks = [], cables = [], panel, JR = 0, rafId = 0;
  const mouse = { x: -1e9, y: -1e9 };
  let drag = null;                    // { cable, end: "a"|"b" }
  const crossOrder = new Map();       // who is over whom, per crossing pair, while they cross
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
    LIFT_Z = 26 * dpr; POST_H = LIFT_Z * 0.85;
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
    // the bottom row stays clear of the floor: a cord lying on the shelf, a
    // plug's width tall, must fit under the lowest socket's nut
    const floorRoom = JR * 1.45 + 24 * dpr;
    for (let gx = gap / 2; gx < w; gx += gap) for (let gy = gap / 2; gy < h - floorRoom; gy += gap) {
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
  // A hole another cord lies across is not open: a plug cannot go in through
  // a cord. The cord being carried does not count — its own body hovers over
  // the hole it is heading for.
  function covered(j, except) {
    return cables.some((o) => o !== except && o.pts.some((p) => Math.hypot(p.x - j.x, p.y - j.y) < JR + o.r));
  }
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
    c.pts = []; c.prev = []; c.onPost = new Uint8Array(N); c.stuck = new Uint8Array(N);
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
    // a plug the deal put in under another cord is re-dealt; the hang of a
    // settled cord is not the straight line it was dealt on, so check after
    for (let round = 0; round < 8; round++) {
      const bad = cables.find((c) => covered(c.a, c) || covered(c.b, c));
      if (!bad) break;
      cables.splice(cables.indexOf(bad), 1);
      const [a, b] = pickPair();
      if (!a || !b) break;
      bad.a = bad.na = a; bad.b = bad.nb = b;
      bad.len = Math.hypot(b.x - a.x, b.y - a.y) * bad.slack; bad.rest = bad.len / (N - 1);
      ropeInit(bad); cables.push(bad);
      // the others may have settled — and slept — against the cord that just
      // moved; frozen leaning on nothing, they held that lean until the first
      // grab woke them and the whole cord lurched
      for (const c of cables) wake(c);
      for (let i = 0; i < 200; i++) step();
    }
    for (const c of cables) { restOn(c, "a"); restOn(c, "b"); }   // ponytail: only matters if a round ran out
  }
  // A plug seated UNDER a resting cord lifts it onto its back — that is where
  // the cord is from then on (the deal lays cords across plugs the same way).
  // A cord dragged into a post's side is blocked by it; this is the other case.
  function restOn(c, name) {
    const post = posts().find((q) => q.c === c && q.name === name);
    if (!post) return;
    const dx = post.x1 - post.x0, dy = post.y1 - post.y0, ll = dx * dx + dy * dy || 1;
    for (const o of cables) {
      if (o === c) continue;
      for (let i = 0; i < N; i++) {
        const p = o.pts[i];
        const t = Math.max(0, Math.min(1, ((p.x - post.x0) * dx + (p.y - post.y0) * dy) / ll));
        if (Math.hypot(p.x - post.x0 - dx * t, p.y - post.y0 - dy * t) < post.r + o.r) { o.onPost[i] = 1; wake(o); }
      }
    }
  }

  // ── physics ──────────────────────────────────────────────────────────────
  // Gravity and damping only: a hanging cord swings like a pendulum and settles
  // like one. STIFF is the cord's resistance to bending, LEN the iterations that
  // hold its length — a cord's length is the one thing that must never give.
  // GZ is how hard a lifted cord wants the board back: at 0.06 a hand at LIFT_Z
  // held most of the cord in the air and it floated over plugs and cords it
  // should have been dragging across; at 0.5 it is back on the board a few
  // segments from the hand.
  const G = 2.5, GZ = 0.5, DAMP = 0.975;
  // z is in the same units as x and y, so the hand's lift scales with dpr like
  // everything else — unscaled, a post on a dpr-2 screen was barely a cord
  // higher than a cord
  let LIFT_Z = 26, POST_H = LIFT_Z * 0.85;
  const STIFF = 0.34, LEN = 24, SUB = 8, MIN_BEND = 72, UNKINK = 0.35;

  // Carried: in the hand, and the hand has actually moved off (the lift's
  // own 40px). Gripped in place, a cord keeps its shape and its shelf pins.
  function carried(c) {
    return !!drag && drag.cable === c && Math.hypot(c.pts[drag.end === "a" ? 0 : N - 1].x - drag.gx, c.pts[drag.end === "a" ? 0 : N - 1].y - drag.gy) > 40 * dpr;
  }
  function ropeView(c) {
    return { pts: c.pts, prev: c.prev, r: c.r, rest: c.rest,
      heldA: heldEnd(c, "a"), heldB: heldEnd(c, "b"), freeA: !!c.looseA, freeB: !!c.looseB, onPost: c.onPost, frozen: !!c.asleep, pinned: c.stuck, frameStart: c.lastPts };
  }
  function heldEnd(c, name) {
    return (drag && drag.cable === c && drag.end === name) || (c.move < 1 && (name === "a" ? c.a !== c.na : c.b !== c.nb));
  }

  // A cord cannot be stretched. If the hand asks for more cord than there is —
  // the cord is caught on something between it and the far end — the plug
  // stops short of the cursor, taut, by however much is missing.
  function arc(c) { let a = 0; for (let i = 0; i < N - 1; i++) a += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y, c.pts[i + 1].z - c.pts[i].z); return a; }
  function yieldHand() {
    if (!drag) return;
    const c = drag.cable, i = drag.end === "a" ? 0 : N - 1, j = drag.end === "a" ? 1 : N - 2;
    // The hand stays at the cursor: a caught cord STRETCHES a little (up to
    // STRETCH of its length) before the plug is held back — retreating the
    // hand by every px of excess parted it from the cursor the moment the
    // cord touched anything, and by the solver's own residual on every drag.
    const over = arc(c) - c.len;
    // The cord is taut from the hand to whatever holds it: if that is a
    // shelf point, the pull peels it off — the nearest to the hand, one a
    // pass. A REAL pull: the solver's normal half-percent residual is a few
    // px of excess on a long cord, and at that bar every pin let go the
    // frame a settled cord was gripped, and it lost its shape unmoved.
    if (over > Math.max(8 * dpr, 0.02 * c.len)) { const dir = drag.end === "a" ? 1 : -1; for (let k = i; k >= 0 && k < N; k += dir) if (c.stuck[k]) { c.stuck[k] = 0; break; } }
    const excess = over - STRETCH * c.len;
    // and only held back by something it is pressed against: a fast drag's
    // unconverged solve, or a lift onto a plug's back mid-cord, is excess
    // too, and retreating for that stuttered the hand 14px for a frame
    if (excess <= 0 || !(c.pressing && c.pressing.length)) return;
    const p = c.pts[i], q = c.pts[j], d = Math.hypot(p.x - q.x, p.y - q.y) || 1e-6;
    const back = Math.min(excess, d);
    p.x -= ((p.x - q.x) / d) * back; p.y -= ((p.y - q.y) / d) * back;
  }
  // The strain of a caught cord goes into whatever it is caught on. When the
  // hand cannot reach the cursor and the dragged cord is pressed against a
  // seated plug's post, that plug is being tugged; enough of it and it gives.
  const STRETCH = 0.06, TUG_FRAMES = 25;
  function tug() {
    const strained = new Set();
    if (drag) {
      const c = drag.cable, p = c.pts[drag.end === "a" ? 0 : N - 1];
      const far = c.pts[drag.end === "a" ? N - 1 : 0];
      const maxR = Math.sqrt(Math.max(0, c.len * c.len - LIFT_Z * LIFT_Z));
      // strained: the cord is stretched past its length (the hand is at the
      // cursor; a caught cord stretches) or held back from the cursor
      const short = arc(c) > c.len * (1 + STRETCH / 3) || Math.hypot(mouse.x - p.x, mouse.y - p.y) > 20 * dpr;
      const farLoose = c[drag.end === "a" ? "looseB" : "looseA"];
      const straight = !farLoose && Math.hypot(mouse.x - far.x, mouse.y - far.y) >= maxR;   // simply out of cord: nothing to tug
      if (short && !straight) for (const post of c.pressing || []) if (post.c !== c) strained.add(cables.indexOf(post.c) + post.name);
    }
    cables.forEach((o, oi) => { for (const name of ["a", "b"]) {
      const key = "tug" + name;
      if (strained.has(oi + name)) {
        o[key] = (o[key] || 0) + 1;
        if (o[key] >= TUG_FRAMES) { unplug(o, name); o[key] = 0; }
      } else o[key] = Math.max(0, (o[key] || 0) - 2);
    } });
  }
  // waking does not unstick: a grabbed cord keeps the shape the shelf holds
  // until the pull reaches each point (yieldHand peels them off in turn)
  function wake(c) { c.asleep = false; c.stillFrames = 0; }
  function unplug(c, name) {
    for (const o of cables) { wake(o); if (o.hookKey === cables.indexOf(c) + name) o.hookKey = null; }   // whatever leaned on, or hung on, this plug wakes and lets go
    const i = name === "a" ? 0 : N - 1;
    const p = c.pts[i], point = { x: p.x, y: p.y };
    if (name === "a") { c.a = c.na = point; c.looseA = true; } else { c.b = c.nb = point; c.looseB = true; }
    c.prev[i].x = p.x; c.prev[i].y = p.y; c.prev[i].z = p.z;   // a pinned end has no history; without this it launches
  }

  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }

  function step() {
    // A cord nobody is touching that has been all but still for half a
    // second goes to sleep: frozen where it is until a hand, a plug, or a
    // moving cord disturbs it. Position-based solvers with several rules in
    // contact settle to a shimmer of a pixel or so, never to zero; sleep is
    // how physics engines make "still" mean still.
    for (const c of cables) if (!c.asleep) integrate3(ropeView(c), G * dpr, GZ, DAMP);
    // Where each held plug starts this frame, so it can be walked to the mouse
    // across the substeps. A hand that teleports a hundred pixels in one frame
    // yanks the first segment to many times its rest length, and the length
    // solve cannot undo that within the frame — the cord visibly stretches.
    const from = {};
    for (const c of cables) for (const [name, idx] of [["a", 0], ["b", N - 1]])
      if (drag && drag.cable === c && drag.end === name) from[name] = { x: c.pts[idx].x, y: c.pts[idx].y };
    // pin ends: seated plugs sit at their jack (z 0), the held plug rides the hand
    const pin = (f = 1) => {
      // The bottom of the board is a solid shelf: no cord goes through it,
      // and what lands on it stops dead. Shelf friction is `stuck` (below):
      // a point that has all but stopped on the shelf becomes a pinned point
      // in every solver pass, so nothing fights it. (Snapping shelf points
      // back after the solve — per frame, per substep, with hysteresis —
      // always made a limit cycle or fed a swing that grew.)
      for (const c of cables) for (let i = 0; i < N; i++) {
        // a loose plug lies on the shelf on its barrel, a barrel radius up
        // (the nut radius put its axis 15px above the cord and kinked it)
        const loose = (i === 0 && c.looseA) || (i === N - 1 && c.looseB);
        const floor = h - (loose ? c.width * 1.2 : c.r);
        const p = c.pts[i], q = c.prev[i];
        if (p.y > floor) { p.y = floor; p.z = Math.min(p.z, 2 * c.r); q.x = p.x; q.y = p.y; q.z = Math.min(q.z, p.z); }
        // no side walls: a cord swings off the screen and an end may come to
        // rest out there (Jango; the walls had stopped a swing at the edge)
      }
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
            // a loose far end is no anchor: the cord follows the hand and
            // drags that end along (the reach circle stalled the hand)
            const farLoose = c[name === "a" ? "looseB" : "looseA"];
            if (!farLoose && rd > maxR && rd > 1e-6) { mx = far.x + (rx / rd) * maxR; my = far.y + (ry / rd) * maxR; }
            // (no magnet on the hand: blending its aim toward a hole within
            // SNAP drew the plug 15px off the cursor every time it passed one.
            // The ring marks the hole; the release seats it.)
            // (the hand is never walled off from the cursor: the cord's first
            // free point is what the bar holds, swept, in offPost3 — a wall
            // at the hand parted it from the cursor by 250px while caught)
            // The plug is in the hand: it is at the cursor at the end of every
            // frame, however fast. A 64px-a-frame cap kept the first segment
            // from stretching on a flick and trailed a brisk drag by 280px.
            const fr = from[name] || { x: mx, y: my };
            const p = c.pts[idx];
            // The lift comes with the carry, not the grab: lifted to LIFT_Z
            // the instant it was gripped, the first segments tilted into z,
            // shortened in the plane, and reeled a settled cord's corner
            // 28px along before the hand had moved. A hand that has closed
            // on a plug has not lifted it yet.
            const lift = Math.min(1, Math.hypot(p.x - drag.gx, p.y - drag.gy) / (40 * dpr));
            p.x = fr.x + (mx - fr.x) * f; p.y = fr.y + (my - fr.y) * f; p.z = LIFT_Z * lift;
          } else if (c[name === "a" ? "looseA" : "looseB"]) {
            // loose: nothing holds it but the floor (below)
          } else if (c.move < 1) {
            const k = ease(c.move);
            const from = name === "a" ? c.a : c.b, to = name === "a" ? c.na : c.nb;
            const p = c.pts[idx]; p.x = from.x + (to.x - from.x) * k; p.y = from.y + (to.y - from.y) * k; p.z = LIFT_Z * (1 - k);
          } else {
            const j = name === "a" ? c.a : c.b;
            const p = c.pts[idx]; p.x = j.x; p.y = j.y; p.z = 0;
            // The plug is seated: its barrel — the cord's first stretch — lies
            // ON the board. Left free in z, a cord pressed against the barrel
            // lifted its points, the cord bunched, and the unkink pass swung
            // the whole barrel round: the post turned 75° under the cord
            // caught on it and shed it. Pinned in the plane as well, the
            // barrel had to be aimed, and every aim chased the cord's own
            // exit round in circles. Height only.
            const k = barrelPts(c), dir = name === "a" ? 1 : -1;
            for (let m = 1; m < k; m++) { const q = c.pts[idx + dir * m]; q.z = 0; c.prev[idx + dir * m].z = 0; }
          }
        }
      }
    };
    // Each substep: bend, then length, then contact, then a light length pass.
    for (let s = 1; s <= SUB; s++) {
      const f = s / SUB;
      for (const c of cables) if (!c.asleep) {
        const v = ropeView(c);
        bend3(v, STIFF);
        unkink3(v, MIN_BEND, UNKINK);
      }
      // The length solve in slices, posts between them: a strained cord's
      // solve cuts straight through a post if it runs to completion first,
      // and once a stretch is deep inside a rounded post end there is no
      // telling which side it came from. A few px at a time, there is.
      for (let k = 0; k < LEN / 6; k++) {
        for (const c of cables) if (!c.asleep) constrainLength3(ropeView(c), 6);
        pin(f);
        for (const c of cables) if (!c.asleep) offPosts(c);
      }
      // cord against cord (over/under, and a cord against itself), a light
      // length pass for the few px of stretch it leaves, then the posts have
      // the last word: a caught cord stays caught
      // a sleeping cord is a static obstacle here (frozen): woken by a hand,
      // a plug seating or popping, never by a push
      collide3(cables.map(ropeView), 2, crossOrder);
      pin(f);
      for (const c of cables) if (!c.asleep) constrainLength3(ropeView(c), 4);
      pin(f);
      for (const c of cables) if (!c.asleep) offPosts(c);
      yieldHand();
    }
    tug();
    // Sleep: nothing moving more than a couple of px a frame for 30 frames,
    // AND nowhere it was not 30 frames ago. A shimmer — the solver's rules
    // trading a pixel back and forth — has next to no net travel and is put
    // to sleep; a swing carries the cord tens of px in 30 frames and is left
    // to run down. The dragged cord never sleeps.
    for (const c of cables) {
      const last = c.lastPts || (c.lastPts = new Float64Array(2 * N));
      const ago = c.agoPts || (c.agoPts = new Float64Array(2 * N).fill(NaN));
      let moved = 0, net = 0;
      const busy = drag && drag.cable === c;
      for (let i = 0; i < N; i++) {
        const p = c.pts[i], m = Math.max(Math.abs(p.x - last[2 * i]), Math.abs(p.y - last[2 * i + 1]));
        // Shelf friction: a point in the pile zone — on the shelf, or resting
        // on the pile within a plug's width of it — that has been still for
        // ten frames is held there (a pinned point in every pass) until a
        // pull peels it off or a neighbouring stretch is pulled past 15%.
        // Points on top of the pile never pinned before, and shimmered
        // between their pinned neighbours for ever.
        const seg = (k) => k >= 0 && k < N - 1 ? Math.hypot(c.pts[k + 1].x - c.pts[k].x, c.pts[k + 1].y - c.pts[k].y, c.pts[k + 1].z - c.pts[k].z) / c.rest : 1;
        const pulled = (k) => seg(k) > 1.15;
        // pin only at rest spacing: pinned in a stretch, the free run between
        // two pins could never satisfy its lengths and vibrated for ever
        const relaxed = Math.abs(seg(i - 1) - 1) < 0.05 && Math.abs(seg(i) - 1) < 0.05;
        const pileZone = p.y >= h - 40 * dpr;
        const sp = c.stillPt || (c.stillPt = new Uint8Array(N));
        sp[i] = !busy && m < 1.5 * dpr && relaxed ? Math.min(255, sp[i] + 1) : 0;
        // A carried cord's shelf section SLIDES along: a cord dragged across
        // a table does not stick to it. Pinned, the cord stretched 2% against
        // its own pins and peeled them one at a time (Jango: "sticky").
        if (!pileZone || pulled(i - 1) || pulled(i) || carried(c)) c.stuck[i] = 0;
        else if (sp[i] >= 10) { c.stuck[i] = 1; c.prev[i].x = p.x; c.prev[i].y = p.y; c.prev[i].z = p.z; }
        moved = Math.max(moved, m); net = Math.max(net, Math.abs(p.x - ago[2 * i]), Math.abs(p.y - ago[2 * i + 1])); last[2 * i] = p.x; last[2 * i + 1] = p.y;
      }
      // A shimmer of a pixel or so with no net travel is put to sleep (a
      // frozen one that size wakes invisibly); 2.5px a frame was too loose —
      // a real vibration froze and snapped on waking.
      c.stillFrames = moved < 1.5 * dpr && !busy ? (c.stillFrames || 0) + 1 : 0;
      if (c.stillFrames % 30 === 0) {
        if (c.stillFrames >= 30 && net < 1.0 * dpr && !c.asleep) { c.asleep = true; for (let i = 0; i < N; i++) { c.prev[i].x = c.pts[i].x; c.prev[i].y = c.pts[i].y; c.prev[i].z = c.pts[i].z; } }
        for (let i = 0; i < N; i++) { ago[2 * i] = c.pts[i].x; ago[2 * i + 1] = c.pts[i].y; }
      }
    }
    for (const c of cables) if (c.move < 1) {
      c.move = Math.min(1, c.move + (c.moveSpeed || 0.05));
      if (c.move >= 1) {   // the seat is done: the plug lives in the hole now
        const end = c.a !== c.na ? "a" : c.b !== c.nb ? "b" : null;
        c.a = c.na; c.b = c.nb;
        if (end) restOn(c, end);
      }
    }
  }

  // A seated plug is a post: a capsule from the jack along the barrel, as
  // drawn, standing off the board. No cord at board height passes through
  // one — not another cord, not its own cord folding back over its barrel.
  // A held or still-seating plug is in the air and is no obstacle.
  const BARREL = () => 15 * dpr * 1.8;
  function posts() {
    const out = [];
    for (const c of cables) {
      if (c.move < 1 || (drag && drag.cable === c)) continue;
      for (const [name, i0, i1] of [["a", 0, 2], ["b", N - 1, N - 3]]) {
        if (c[name === "a" ? "looseA" : "looseB"]) continue;
        const p0 = c.pts[i0], p1 = c.pts[i1];
        const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, ux = (p1.x - p0.x) / l, uy = (p1.y - p0.y) / l;
        // the post reaches back past the jack: the plug's cap sits in the
        // socket's nut, and a cord cannot slip round that end either
        out.push({ c, name, ux, uy, jx: p0.x, jy: p0.y, x0: p0.x - ux * JR, y0: p0.y - uy * JR, x1: p0.x + ux * BARREL(), y1: p0.y + uy * BARREL(), r: c.width * 1.2 });
      }
    }
    return out;
  }
  // any point of c within two cord widths of the post capsule itself
  function nearPost(c, post) {
    const dx = post.x1 - post.x0, dy = post.y1 - post.y0, ll = dx * dx + dy * dy || 1, R = post.r + c.r * 3;
    return c.pts.some((p) => { const t = Math.max(0, Math.min(1, ((p.x - post.x0) * dx + (p.y - post.y0) * dy) / ll)); return Math.hypot(p.x - post.x0 - dx * t, p.y - post.y0 - dy * t) < R; });
  }
  // how many points from a seated end lie within the plug (barrel + its radius)
  const barrelPts = (c) => Math.ceil((BARREL() + c.width * 1.2 + c.r) / c.rest);
  function offPosts(c) {
    const v = ropeView(c);
    c.pressing = [];
    const all = posts();
    // a point that has left every post's footprint is no longer on one
    for (let i = 0; i < N; i++) if (c.onPost[i]) {
      const p = c.pts[i];
      let near = false;
      for (const post of all) {
        const dx = post.x1 - post.x0, dy = post.y1 - post.y0, ll = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - post.x0) * dx + (p.y - post.y0) * dy) / ll));
        if (Math.hypot(p.x - post.x0 - dx * t, p.y - post.y0 - dy * t) < post.r + c.r + 2) { near = true; break; }
      }
      if (!near) c.onPost[i] = 0;
    }
    for (const post of all) {
      // its own cord's first stretch IS the barrel: skip what would lie inside
      // the capsule when the cord runs straight out of it
      const skip = post.c === c ? barrelPts(c) : -1;
      // a cord riding OVER another is never caught on that cord's plug: it
      // rides over the plug as it rides over the cord. The cord BENEATH is
      // always caught — it cannot get above the plug of a cord it is under,
      // however high the hand holds it. Unrelated cords: geometry decides.
      // Hooked on this plug, the cord is in contact with the plug's cord as
      // far as over/under goes: the pair's order is pruned when the cord
      // BODIES touch nowhere, and with it went the post's block — the under
      // cord slipped past the plug the moment it left the other cord's body.
      const key = cables.indexOf(post.c) + post.name;
      if (post.c !== c && c.hookKey === key) { const i = cables.indexOf(c), j = cables.indexOf(post.c); const pk = i < j ? i + ":" + j : j + ":" + i; if (!crossOrder.has(pk)) crossOrder.set(pk, i < j ? -1 : 1); }
      const rel = post.c === c ? 0 : over(c, post.c);
      // Unrelated cords: geometry decides for a cord at rest, but a cord
      // being CARRIED goes over the plug of any cord it is not under — its
      // body at board height snagged on the plug's side while the hand went
      // past (Jango: "if cords are separate, the one moved over the other
      // should go over").
      const mode = rel === true ? 1 : rel === false ? -1 : post.c !== c && carried(c) ? 1 : 0;
      // For a DRAGGED cord beneath, hooked on this plug, the post reaches
      // all the way back past the jack: a loose loop rounds any short end
      // long before the pull makes it taut, and a cord cannot come off the
      // plug of a cord it is under that way. The bar latches on when the
      // cord is at the real post, holds while it keeps pressing the bar,
      // and is gone the moment the cord leaves it or the hand lets go — a
      // resting cord, or one dragged elsewhere, never meets it.
      let bar = post;
      if (mode < 0 && drag && drag.cable === c) {
        const long = { ...post, x0: post.jx - post.ux * 4000, y0: post.jy - post.uy * 4000 };
        if (nearPost(c, c.hookKey === key ? long : post)) { bar = long; c.hookKey = key; }
        else if (c.hookKey === key) c.hookKey = null;
      }
      // its own post only ever blocks: a cord leaving its plug cannot fold
      // back over that plug's barrel within the barrel's own length, and
      // letting the top rule try made the exit flicker between lifted and
      // shoved aside
      let moved;
      if (skip < 0) moved = offPost3(v, bar, POST_H, -1, -1, mode);
      else if (post.name === "a") moved = offPost3(v, post, POST_H, 0, skip, -1);
      else moved = offPost3(v, post, POST_H, N - 1 - skip, N - 1, -1);
      if (moved) c.pressing.push(post);
    }
  }
  // is c over o? Only known while they cross (crossOrder); null otherwise
  function over(c, o) {
    const i = cables.indexOf(c), j = cables.indexOf(o);
    const sign = crossOrder.get(i < j ? i + ":" + j : j + ":" + i);
    return sign === undefined ? null : (i < j ? sign : -sign) > 0;
  }
  const SNAP = () => 56 * dpr;
  // nearest open hole within SNAP of (x,y) that the cord can reach from its
  // other end — a cord cannot be stretched to a hole
  function socketNear(c, end, x, y) {
    const far = c.pts[end === "a" ? N - 1 : 0];
    const reach = c[end === "a" ? "looseB" : "looseA"] ? Infinity : Math.sqrt(Math.max(0, c.len * c.len - LIFT_Z * LIFT_Z));
    let best = null, bd = SNAP();
    for (const j of jacks) {
      if (jackTaken(j) || covered(j, c) || Math.hypot(j.x - far.x, j.y - far.y) > reach) continue;
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

  function draw() {
    step();
    rec.dpr = dpr;
    rec.frames.push([Math.round(mouse.x / dpr), Math.round(mouse.y / dpr)]);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(panel, 0, 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const ends = cables.map((c) => [[c.pts[0], c.pts[2]], [c.pts[N - 1], c.pts[N - 3]]]);
    // Under cords first, then what lies over them, each cord with its own
    // plugs: the pair's remembered order says who is on top, all along the
    // overlap. Deciding per crossing from the height right there flipped
    // along two cords lying together at a shallow angle — half and half.
    const rank = cables.map((c) => cables.reduce((n, o) => n + (o === c ? 0 : over(c, o) === true ? 1 : over(c, o) === false ? -1 : 0), 0));
    const order = cables.map((_, i) => i).sort((i, j) => rank[i] - rank[j]);
    for (const i of order) {
      const c = cables[i];
      drawCable(c, c.pts, true, 0);
      if (!heldEnd(c, "a")) drawPlug(c, "a", ends[i][0][0], ends[i][0][1]);
      if (!heldEnd(c, "b")) drawPlug(c, "b", ends[i][1][0], ends[i][1][1]);
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
  const GRAB = () => 14 * dpr;
  // the whole drawn plug is grabbable — the barrel as drawn, from the end
  // point along its angle — not just a spot at the tip: on a hanging cord the
  // plug dangles below the cord and a hand goes for its body
  function plugAt(x, y) {
    for (const c of cables) for (const name of ["a", "b"]) {
      const p = c.pts[name === "a" ? 0 : N - 1], ang = c["ang" + name] ?? 0;
      const ux = Math.cos(ang), uy = Math.sin(ang), L = BARREL();
      const t = Math.max(0, Math.min(L, (x - p.x) * ux + (y - p.y) * uy));
      if (Math.hypot(x - p.x - ux * t, y - p.y - uy * t) < GRAB()) return { cable: c, end: name };
    }
    return null;
  }
  function liftEnd(c, end) {
    wake(c);
    const i = end === "a" ? 0 : N - 1;
    const point = { x: c.pts[i].x, y: c.pts[i].y };
    if (end === "a") { c.a = c.na = point; c.looseA = false; } else { c.b = c.nb = point; c.looseB = false; }
    c.move = 1;
  }
  function trySeat() {
    const c = drag.cable, end = drag.end, p = end === "a" ? c.pts[0] : c.pts[N - 1];
    const best = socketNear(c, end, p.x, p.y)?.j;
    const here = { x: p.x, y: p.y };
    if (!best) {
      // let go clear of any hole, the plug drops where it is and the cord
      // falls: nothing holds an end that is not in a hole or a hand
      if (end === "a") { c.a = c.na = here; c.looseA = true; } else { c.b = c.nb = here; c.looseB = true; }
      c.prev[end === "a" ? 0 : N - 1] = { x: p.x, y: p.y, z: p.z };
      drag = null; canvas.style.cursor = "default"; return;
    }
    // the seat starts where the plug is now, not where it was picked up
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
    hit.cable.hookKey = null;
    liftEnd(hit.cable, hit.end); drag = { cable: hit.cable, end: hit.end, gx: x, gy: y };
    mouse.x = x; mouse.y = y; canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", () => { rec.events.push([rec.frames.length, "up", 0, 0]); if (drag) trySeat(); });

  canvas.__pb3d = () => ({ cables, jacks, dpr, N, drag, rec, crossOrder });
  canvas.__lab = false;
  const onKey = (e) => { if (e.key === "r" || e.key === "R") navigator.clipboard?.writeText(JSON.stringify(rec)).then(() => canvas.dispatchEvent(new CustomEvent("patchbay:copied"))); };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", size);
  size();
  draw();
  return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); };
}
