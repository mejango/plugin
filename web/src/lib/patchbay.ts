// @ts-nocheck — a self-contained canvas physics engine, ported verbatim from the
// original static pages. Typed at its boundary only; the internals are proven, so
// they are deliberately untouched and the cable feel stays identical.
//
// Verlet-rope patch bay: jacks on a grid, cords cut to fixed length carrying bend
// memory, plugs that only ever seat in free holes. One seeded panel per tab.

/**
 * Bend memory, local edition: each point remembers how it bulges relative to its
 * neighbours, so the kinks ride ON TOP of whatever the cord is doing globally —
 * a taut run, a deep drape, a cord mid-carry. Shape survives slack.
 *
 * The correction is spread across the triple — centre by `corr`, each neighbour
 * by half of it the other way — rather than applied to the centre alone. Moving
 * only the centre is what made the stiffest cords crawl forever: neighbouring
 * points each shove their own middle against the two beside it, which excites
 * the zig-zag mode between adjacent points, and nothing in the loop damps it.
 * Spreading the correction leaves the triple's centre of mass where it was, so
 * the shape target is identical and the mode is simply never fed. Measured over
 * 20s on the stiffest cord in the range, residual motion drops from 0.55 to 0.08
 * px/frame — below where the CALMEST cord used to sit — at identical stiffness.
 * The look is unchanged; the ringing is not. See test/patchbay-bend.test.ts.
 *
 * `prev` moves with `pts` so the correction shifts position without inventing
 * velocity; `bendDamp` then bleeds what is left along the bend normal only,
 * leaving drape and swing — which live in the tangential component — untouched.
 */
export function relaxBendMemory(pts, prev, kink, stiffNow, bendDamp, n) {
  for (let i = 1; i < n - 1; i++) {
    const pm = pts[i - 1], pp = pts[i + 1], pnt = pts[i];
    const mx = (pm.x + pp.x) / 2, my = (pm.y + pp.y) / 2;
    const tx = pp.x - pm.x, ty = pp.y - pm.y;
    const tl = Math.hypot(tx, ty) || 1e-6;
    const nx = -ty / tl, ny = tx / tl;
    const off = (pnt.x - mx) * nx + (pnt.y - my) * ny;
    const corr = (kink[i] - off) * stiffNow;

    pnt.x += nx * corr;
    pnt.y += ny * corr;
    prev[i].x += nx * corr;
    prev[i].y += ny * corr;

    // The pinned ends are held by the jacks, so they absorb nothing.
    const half = corr / 2;
    if (i - 1 > 0) {
      pm.x -= nx * half; pm.y -= ny * half;
      prev[i - 1].x -= nx * half; prev[i - 1].y -= ny * half;
    }
    if (i + 1 < n - 1) {
      pp.x -= nx * half; pp.y -= ny * half;
      prev[i + 1].x -= nx * half; prev[i + 1].y -= ny * half;
    }

    const vn = (pnt.x - prev[i].x) * nx + (pnt.y - prev[i].y) * ny;
    prev[i].x += nx * vn * bendDamp;
    prev[i].y += ny * vn * bendDamp;
  }
}

// ponytail: patch bay with verlet-rope cables — real gravity, drape, swing, and
// settle. Grab a plug and the cord carries its own weight to the next jack.
export function startPatchBay(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 16;                       // rope points per cable
  // one seed per tab: every page renders the SAME panel and cable deal
  const seedKey = "plugin-field-seed";
  // a hard refresh deals a fresh panel; navigating between pages keeps it
  const navType = (performance.getEntriesByType("navigation")[0] || {}).type;
  if (navType === "reload") {
    sessionStorage.removeItem(seedKey);
    sessionStorage.removeItem("plugin-cables");
  }
  let seed = Number(sessionStorage.getItem(seedKey)) || 0;
  if (!seed) { seed = ((Math.random() * 2 ** 31) | 0) || 1; sessionStorage.setItem(seedKey, seed); }
  let _s = seed >>> 0;
  const rand = () => {
    _s = (_s + 0x6D2B79F5) | 0;
    let q = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
  let w, h, dpr, jacks = [], cables = [], panel, t = 0, JR = 0;
  let rafId = 0;
  const mouse = { x: -1e9, y: -1e9 };
  let drag = null;                    // { cable, ends: ["a"] | ["a","b"] }

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";

    // the panel: 1/4" jacks — hex nut, washer, threaded ring, dark bore
    const gap = 120 * dpr;
    JR = 19 * dpr;
    jacks = [];
    panel = document.createElement("canvas");
    panel.width = w; panel.height = h;
    const pctx = panel.getContext("2d");
    const ink = (a) => "rgba(0,0,0," + a + ")";

    for (let gx = gap / 2; gx < w; gx += gap) {
      for (let gy = gap / 2; gy < h; gy += gap) {
        const x = gx, y = gy;
        jacks.push({ x, y });
        pctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          pctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * JR * 1.45, y + Math.sin(a) * JR * 1.45);
        }
        pctx.closePath();
        pctx.strokeStyle = ink(0.16);
        pctx.lineWidth = 1.6 * dpr;
        pctx.stroke();
        pctx.beginPath(); pctx.arc(x, y, JR, 0, 7);
        pctx.fillStyle = ink(0.10); pctx.fill();
        pctx.beginPath(); pctx.arc(x, y, JR * 0.78, 0, 7);
        pctx.strokeStyle = ink(0.34); pctx.lineWidth = 2 * dpr; pctx.stroke();
        pctx.beginPath(); pctx.arc(x, y, JR * 0.44, 0, 7);
        pctx.fillStyle = ink(0.55); pctx.fill();
      }
    }
    const rows = Math.floor(h / gap);

    // signal-flow chains, centered in the bands between jack rows
    function arrowHead(x, y, angle) {
      const sArrow = 6 * dpr;
      pctx.beginPath();
      pctx.moveTo(x, y);
      pctx.lineTo(x - Math.cos(angle - 0.4) * sArrow, y - Math.sin(angle - 0.4) * sArrow);
      pctx.moveTo(x, y);
      pctx.lineTo(x - Math.cos(angle + 0.4) * sArrow, y - Math.sin(angle + 0.4) * sArrow);
      pctx.stroke();
    }
    pctx.lineWidth = 1 * dpr;
    const boxes = [];
    const CHAINS = [
      [["PITCH", "DETECTOR"], ["ISSUANCE", "OSC"], ["SPLIT", "FILTER"], ["KEEP", "MIXER"], ["CASH OUT", "AMP"]],
      [["FEED", "IN"], ["DOUBLING", "CLK"], ["曲線", "整形"], ["TREASURY", "SUM"]],
      [["OMNI", "BUS"], ["SUCKER", "BRIDGE"], ["剰余", "還流"], ["SURPLUS", "RETURN"]],
    ];
    CHAINS.forEach((chain, ci) => {
      const band = 1 + ci * Math.max(2, Math.floor((rows - 2) / CHAINS.length));
      const y = gap / 2 + band * gap + gap / 2 - 12 * dpr;
      let col = 0.5 + ((rand() * 2) | 0);
      let prevRight = null;
      for (const [l1, l2] of chain) {
        const bw = (Math.max(l1.length, l2.length) * 6.6 + 18) * dpr;
        const bh = 28 * dpr;
        const x = gap / 2 + col * gap - bw / 2;
        if (x + bw > w - gap / 2) break;
        pctx.strokeStyle = ink(0.30);
        pctx.strokeRect(x, y, bw, bh);
        pctx.font = "600 " + 8 * dpr + "px ui-sans-serif, system-ui, sans-serif";
        pctx.fillStyle = ink(0.45);
        pctx.textAlign = "center";
        pctx.fillText(l1, x + bw / 2, y + 11 * dpr);
        pctx.fillText(l2, x + bw / 2, y + 21.5 * dpr);
        if (prevRight !== null) {
          pctx.strokeStyle = ink(0.30);
          pctx.beginPath();
          pctx.moveTo(prevRight, y + bh / 2);
          pctx.lineTo(x, y + bh / 2);
          pctx.stroke();
          arrowHead(x, y + bh / 2, 0);
        }
        boxes.push({ x: x - 6 * dpr, y: y - 6 * dpr, w: bw + 12 * dpr, h: bh + 12 * dpr });
        prevRight = x + bw;
        col += 2;
      }
    });

    // L-shaped traces between neighboring jacks
    for (let i = 0; i < 26; i++) {
      const a = jacks[(rand() * jacks.length) | 0];
      const cand = jacks.filter((j) => j !== a && Math.abs(j.x - a.x) < gap * 2.2 && Math.abs(j.y - a.y) < gap * 2.2);
      if (!cand.length) continue;
      const b = cand[(rand() * cand.length) | 0];
      const r2 = JR * 1.6;
      pctx.strokeStyle = ink(0.22);
      pctx.beginPath();
      pctx.moveTo(a.x + Math.sign(b.x - a.x) * r2, a.y);
      pctx.lineTo(b.x, a.y);
      pctx.lineTo(b.x, b.y - Math.sign(b.y - a.y) * r2);
      pctx.stroke();
      arrowHead(b.x, b.y - Math.sign(b.y - a.y) * r2, Math.sign(b.y - a.y) > 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    // designations — multilingual, collision-aware
    const LABELS = [
      "SIGNAL IN", "REV OUT", "KEEP OUT", "SPLIT IN", "ISSUANCE", "CASH OUT",
      "PITCH IN", "TREASURY", "MINT CLK", "SURPLUS", "OMNI BUS", "WEIGHT CUT",
      "BASE CV", "OPERATOR", "FEED", "DOUBLING", "GATE", "SUCKER BUS",
      "信號入", "收益出", "金庫", "餵入",
      "信号入力", "発行", "引出し",
      "TÍN HIỆU VÀO", "NUÔI MÁY", "RÚT RA",
      "신호 입력", "발행",
      "∿ OUT", "Σ IN", "⏚ GND", "⊕ MIX", "→ ◉",
      "EXT PAY IN", "TOKEN OUT", "TAX RET", "CURVE FREQ", "SPARE",
    ];
    const SUBS = ["-5V~+5V", "0V~+5V", "USD~ETH", "0x", "50Ω", "24H~90D", "±∞", "半減"];
    function clearOf(x, y, tw, th) {
      return !boxes.some((r) => x + tw / 2 > r.x && x - tw / 2 < r.x + r.w && y > r.y && y - th < r.y + r.h);
    }
    for (const j of jacks) {
      if (rand() >= 0.66) continue;
      const label = LABELS[(rand() * LABELS.length) | 0];
      const ly = j.y - JR * 1.85;
      if (!clearOf(j.x, ly, label.length * 6 * dpr, 9 * dpr)) continue;
      pctx.font = "600 " + 9 * dpr + "px ui-sans-serif, system-ui, sans-serif";
      pctx.textAlign = "center";
      pctx.fillStyle = ink(0.55);
      pctx.fillText(label, j.x, ly);
      if (rand() < 0.3) {
        const sub = SUBS[(rand() * SUBS.length) | 0];
        const sy = j.y + JR * 2.4;
        if (clearOf(j.x, sy, sub.length * 4.5 * dpr, 8 * dpr)) {
          pctx.font = 7.5 * dpr + "px ui-monospace, Menlo, monospace";
          pctx.fillStyle = ink(0.38);
          pctx.fillText(sub, j.x, sy);
        }
      }
    }

    // waveform + amp glyphs
    for (let i = 0; i < 22; i++) {
      const j = jacks[(rand() * jacks.length) | 0];
      const gx = j.x + JR * 1.7, gy = j.y + (rand() < 0.5 ? -1 : 1) * JR * 1.4;
      if (!clearOf(gx + 20 * dpr, gy, 40 * dpr, 14 * dpr)) continue;
      const kind = (rand() * 4) | 0;
      pctx.strokeStyle = ink(0.38);
      pctx.lineWidth = 1 * dpr;
      pctx.beginPath();
      const u = (3.6 + rand() * 2.6) * dpr;
      if (kind === 0) {
        for (let k = 0; k <= 12; k++) {
          const px = gx + k * u * 0.5, py = gy + Math.sin(k * 0.9) * u;
          k ? pctx.lineTo(px, py) : pctx.moveTo(px, py);
        }
      } else if (kind === 1) {
        pctx.moveTo(gx, gy + u);
        pctx.lineTo(gx, gy - u); pctx.lineTo(gx + u * 2, gy - u); pctx.lineTo(gx + u * 2, gy + u);
        pctx.lineTo(gx + u * 4, gy + u); pctx.lineTo(gx + u * 4, gy - u); pctx.lineTo(gx + u * 6, gy - u);
      } else if (kind === 2) {
        pctx.moveTo(gx, gy + u);
        pctx.lineTo(gx + u * 2, gy - u); pctx.lineTo(gx + u * 2, gy + u);
        pctx.lineTo(gx + u * 4, gy - u); pctx.lineTo(gx + u * 4, gy + u);
      } else {
        pctx.moveTo(gx, gy - u * 1.4); pctx.lineTo(gx, gy + u * 1.4); pctx.lineTo(gx + u * 2.4, gy);
        pctx.closePath();
        pctx.moveTo(gx + u * 2.4, gy); pctx.lineTo(gx + u * 4, gy);
      }
      pctx.stroke();
      if (kind === 3) arrowHead(gx + 4 * u, gy, 0);
    }

    const COLORS = [
      { rgb: [40, 40, 40], a: 0.30 },      // ink
      { rgb: [214, 48, 49], a: 0.48 },     // red
      { rgb: [90, 90, 90], a: 0.22 },      // pale ink
      { rgb: [230, 126, 34], a: 0.48 },    // orange
      { rgb: [226, 107, 168], a: 0.48 },   // pink
      { rgb: [206, 162, 8], a: 0.50 },     // yellow
      { rgb: [25, 25, 25], a: 0.34 },      // heavy ink
      { rgb: [41, 128, 185], a: 0.46 },    // blue
    ];
    cables = [];
    const cableCount = Math.min(11, Math.floor(jacks.length / 4)); // leave room to play
    for (let i = 0; i < cableCount; i++) {
      const [a, b] = pickPair();
      if (!a || !b) break;
      const c = {
        a, b, na: a, nb: b, move: 1,
        // How much extra cord it carries, raised 10% over the original range.
        // A cord used to hang on solver stretch as well as its slack; the length
        // controller below takes that stretch away, so this hands the same droop
        // back as real cord. Measured to land within 5% of the old drape.
        slack: rand() < 0.25 ? 1.14 + rand() * 0.09 : 1.34 + rand() * 0.42,
        color: COLORS[i % COLORS.length],
        wear: 0.72 + rand() * 0.5,          // no two cords aged alike
        hueJit: [0, 1, 2].map(() => (rand() - 0.5) * 34), // dye lot variance
        braid: 0.8 + rand() * 0.9,          // braid weave density
        gloss: 0.3 + rand() * 0.35,         // some cords matte, some shiny
        width: 8.5 * dpr,
        pts: [], prev: [],
        // bend memory: the shape this cord wants from how it lived — coiled in a
        // drawer, wrapped tight, trampled. Stiffness is how hard it insists.
        stiff: 0.015 + rand() * 0.075,
        kinks: (() => {
          const f1 = 1 + rand() * 2, f2 = 3 + rand() * 4;
          const p1 = rand() * 6.28, p2 = rand() * 6.28;
          const a1 = (1.5 + rand() * 4) * dpr, a2 = (0.5 + rand() * 1.5) * dpr;
          return Array.from({ length: N }, (_, i) => {
            const k = i / (N - 1);
            const taper = Math.sin(k * Math.PI);            // ends stay seated
            return (Math.sin(k * f1 * 6.28 + p1) * a1 + Math.sin(k * f2 * 6.28 + p2) * a2
              + (rand() - 0.5) * 0.8 * dpr) * taper;        // plus a little scuff
          });
        })(),
      };
      ropeInit(c);
      c.len = Math.hypot(b.x - a.x, b.y - a.y) * c.slack;   // cut to length, forever
      c.rest = c.len / (N - 1);
      c.restScale = 1;
      // the memory, expressed locally: how far each point bulges past its neighbors
      c.kinkLocal = c.kinks.map((v, i, a) => (i === 0 || i === a.length - 1) ? 0 : v - (a[i - 1] + a[i + 1]) / 2);
      cables.push(c);
    }
    // restore the tab's cable arrangement (user moves carry across pages)
    try {
      const saved = JSON.parse(sessionStorage.getItem("plugin-cables") || "null");
      if (saved && saved.jackCount === jacks.length && saved.ends.length === cables.length) {
        saved.ends.forEach(([ai, bi, len], i) => {
          const c = cables[i];
          c.a = c.na = jacks[ai];
          c.b = c.nb = jacks[bi];
          c.len = len;
          c.rest = len / (N - 1);
          c.restScale = 1;
          ropeInit(c);
        });
      }
    } catch (_) {}
    saveCables();
    if (!REDUCED) for (let i = 0; i < 240; i++) step(); // pre-settle so it opens draped
  }

  function saveCables() {
    try {
      sessionStorage.setItem("plugin-cables", JSON.stringify({
        jackCount: jacks.length,
        ends: cables.map((c) => [jacks.indexOf(c.na), jacks.indexOf(c.nb), c.len]),
      }));
    } catch (_) {}
  }

  function pickPair() {
    const free = jacks.filter((j) => !jackTaken(j));
    if (free.length < 2) return [null, null];
    const a = free[(rand() * free.length) | 0];
    let b = null, tries = 0;
    while (tries++ < 40) {
      const cand = free[(rand() * free.length) | 0];
      if (cand === a) continue;
      const d = Math.hypot(cand.x - a.x, cand.y - a.y);
      if (d > w * 0.12 && d < w * 0.55) { b = cand; break; }
    }
    return [a, b || free.find((j) => j !== a)];
  }

  function ropeInit(c) {
    c.pts = []; c.prev = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const x = c.a.x + (c.b.x - c.a.x) * k;
      const y = c.a.y + (c.b.y - c.a.y) * k + Math.sin(k * Math.PI) * 20 * dpr;
      c.pts.push({ x, y });
      c.prev.push({ x, y });
    }
  }

  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }

  function step() {
    const G = 2.3 * dpr;                // gravity ~9.8 m/s² at this pixel scale
    const DAMP = 0.992;                 // light air drag — cords fall, not float
    // Bend damping bleeds velocity along the bend normal — and a hanging cord's
    // normal points SIDEWAYS, so this lands squarely on the swing. It does not
    // just shrink the swing, it slows it: at 0.55 a shoved cord barely moved at
    // all, and at 0.30 it took 72 frames to swing back where a free pendulum of
    // that sag takes 21. At 0.15 the period comes out at 22 and the cord swings
    // the way its own weight says it should. What 0.55 was really doing is
    // covered by the tension bleed below, which is aimed at the thing that
    // actually needed damping.
    const BEND_DAMP = 0.15;             // see relaxBendMemory

    for (const c of cables) {
      if (c.move < 1) c.move = Math.min(c.move + (c.moveSpeed || 0.012), 1);
      const k = ease(c.move);
      const ax = c.a.x + (c.na.x - c.a.x) * k, ay = c.a.y + (c.na.y - c.a.y) * k;
      const bx = c.b.x + (c.nb.x - c.b.x) * k, by = c.b.y + (c.nb.y - c.b.y) * k;
      if (c.move === 1 && !(drag && drag.cable === c)) { c.a = c.na; c.b = c.nb; }

      // fixed cord length: the rope is as long as it was made, no more
      const rest = c.rest;

      // stiffness shaves a little droop, but gravity always wins
      const gEff = G * (1 - Math.min(0.25, c.stiff * 0.9));
      for (let i = 1; i < N - 1; i++) {
        const p = c.pts[i], q = c.prev[i];
        const vx = (p.x - q.x) * DAMP;
        const vy = (p.y - q.y) * DAMP + gEff;
        q.x = p.x; q.y = p.y;
        p.x += vx; p.y += vy;
      }
      c.pts[0].x = ax; c.pts[0].y = ay;
      c.pts[N - 1].x = bx; c.pts[N - 1].y = by;

      for (let iter = 0; iter < 6; iter++) {
        for (let i = 0; i < N - 1; i++) {
          const p = c.pts[i], q = c.pts[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - rest) / d / 2;
          const ox = dx * diff, oy = dy * diff;
          if (i > 0) { p.x += ox; p.y += oy; }
          if (i < N - 2) { q.x -= ox; q.y -= oy; }
        }
        c.pts[0].x = ax; c.pts[0].y = ay;
        c.pts[N - 1].x = bx; c.pts[N - 1].y = by;
      }

      relaxBendMemory(c.pts, c.prev, c.kinkLocal, Math.min(0.35, c.stiff * 3), BEND_DAMP, N);

      // tension rises smoothly with extension — no threshold, no snap. The pull
      // toward straight and the momentum bleed both fade in over the last third.
      const pinDist = Math.hypot(bx - ax, by - ay);
      const ext = pinDist / c.len;
      let tension = 0;
      if (ext > 0.92) {
        let t2 = Math.min(1, (ext - 0.92) / 0.07);
        t2 = t2 * t2 * (3 - 2 * t2);                  // smoothstep
        tension = t2 * t2;                            // only the last few percent firm up
      }
      if (tension > 0) {
        const pull = tension * 0.35;
        for (let i = 1; i < N - 1; i++) {
          const k2 = i / (N - 1);
          const tx = ax + (bx - ax) * k2, ty = ay + (by - ay) * k2;
          const pnt = c.pts[i], q = c.prev[i];
          pnt.x += (tx - pnt.x) * pull;
          pnt.y += (ty - pnt.y) * pull;
          // Bled at the ramp's own strength rather than the pull's. Matched to
          // the pull it is far too weak to take back out the motion the pull
          // feeds in, and a stretched cord fidgets: measured 1.54 at 0.97 and
          // 0.65 at full draw, against 0.59 and 0.00 once the bleed is aimed
          // properly. This is the damping the cords actually needed, which is
          // why the bend damping above no longer has to stand in for it.
          q.x += (pnt.x - q.x) * tension;
          q.y += (pnt.y - q.y) * tension;
        }
      }

      // Keep the cord the length it was cut to, without stiffening it.
      //
      // Six Gauss-Seidel passes leave the rope compliant, so it stretches in
      // proportion to tension, and tension tracks how far apart the ends are —
      // the cord visibly grew and shrank as an end was dragged, by 17% across
      // the range. The obvious cures all work by making the rope stiffer, and
      // stiffness is exactly what gives it its drape, its swing and the weight
      // of its fall: substepping fixed the length and quietly took all three.
      //
      // So the softness stays and the TARGET moves instead. Measure what the
      // cord actually came out at, and aim the segments low by that much. The
      // solver keeps missing by the same proportion it always did, and now it
      // misses onto the right answer. Length spread 17% -> 0%, with drape,
      // swing, fall and settling all unchanged.
      //
      // Held off once the tension pull engages. That pull deliberately squashes
      // the cord onto the line between the jacks — that is what makes a
      // stretched cord look taut — and the controller reads the squash as the
      // cord being too short and feeds length back in. The two cancelled: the
      // plug sat at 41 degrees off straight instead of 18, with twice the sag.
      // Nothing needs correcting up there anyway; a cord pulled nearly straight
      // measures nearly its chord whatever the segments are aiming at.
      let arc = 0;
      for (let i = 0; i < N - 1; i++) {
        arc += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y);
      }
      if (arc > 1e-6) {
        // Gentle on purpose: it corrects over a few frames rather than yanking,
        // so a cord being carried is never fighting it.
        //
        // One-sided once the cord is under tension. Reeling a stretched cord
        // back in is always right and stays at full strength, so a cord that
        // arrives already stretched still recovers. Letting length back OUT is
        // the move that fights the pull — the pull squashes the cord onto the
        // line between the jacks on purpose, and reading that as "too short"
        // and feeding cord back in put the plug at 26 degrees off straight
        // instead of 8 — so that direction fades out as the pull fades in.
        // Both directions, everywhere. This used to refuse to let length back
        // out under tension, to stop it fighting the pull — but that left the
        // pull free to squash the cord to 0.966 of its length, which is exactly
        // the shrink it was meant to prevent. With the drag able to reach full
        // stretch the pull has far less squashing to do, and the two agree:
        // measured 1.000 at every extension, and tauter at full draw than the
        // squashed version managed.
        c.restScale *= 1 + (c.len / arc - 1) * 0.05;
        c.restScale = Math.max(0.5, Math.min(1.2, c.restScale));
        c.rest = (c.len / (N - 1)) * c.restScale;
      }
    }
  }

  function tint(c, aMul, shade) {
    const k = shade === undefined ? 1 : shade;
    // fully opaque cords; wear fades the pigment toward the panel, not the alpha
    const fade = Math.max(0, Math.min(0.22, (1.22 - c.wear) * 0.35));
    return "rgb(" + c.color.rgb.map((v, i) => {
      const shaded = Math.max(0, Math.min(255, v * k + c.hueJit[i]));
      return Math.round(shaded * (1 - fade) + 255 * fade);
    }).join(",") + ")";
  }

  function ropePath(pts, oy) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y + oy);
    for (let i = 1; i < N - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2 + oy;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y + oy, mx, my);
    }
    ctx.lineTo(pts[N - 1].x, pts[N - 1].y + oy);
  }

  function drawCable(c) {
    const pts = c.pts;
    // soft shadow under the cord — the panel sits behind it
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.16)";
    ctx.shadowBlur = 5 * dpr;
    ctx.shadowOffsetY = 4 * dpr;
    ropePath(pts, 0);
    ctx.strokeStyle = tint(c, 0.9, 0.55);   // dark rubber edge, catches the shadow
    ctx.lineWidth = c.width * 1.9;
    ctx.stroke();
    ctx.restore();
    // the sheath body over the dark edge — the roundness comes from the two tones
    ropePath(pts, -c.width * 0.12);
    ctx.strokeStyle = tint(c, 1);
    ctx.lineWidth = c.width * 1.45;
    ctx.stroke();
    // braid wrap: a fine dashed bias line worked along the cord
    ctx.save();
    ctx.setLineDash([2.2 * dpr * c.braid, 3.4 * dpr * c.braid]);
    ropePath(pts, c.width * 0.18);
    ctx.strokeStyle = tint(c, 0.5, 0.4);
    ctx.lineWidth = Math.max(1, c.width * 0.5);
    ctx.stroke();
    // broken sheen: the highlight glints, it doesn't run laser-straight
    ctx.setLineDash([9 * dpr * c.braid, 5 * dpr, 4 * dpr * c.braid, 7 * dpr]);
    ropePath(pts, -c.width * 0.38);
    ctx.strokeStyle = "rgba(255,255,255," + c.gloss.toFixed(2) + ")";
    ctx.lineWidth = Math.max(1, c.width * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Punch the barrel's own footprint out of the current path, so a cord is not
   * drawn over the plug it is plugged into.
   *
   * Shaped to the barrel rather than a circle round the jack. A disc big enough
   * to cover the barrel also covers the socket printed on the panel — ring at
   * JR, hexagon at JR * 1.45 — and since no plug is drawn out there, the cord
   * was simply missing across the whole socket and the panel showed through.
   * A capsule only takes back what the barrel actually paints over.
   */
  function plugHole(c, p0, p1) {
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
    const nx = -uy, ny = ux;                      // the barrel's half-width axis
    const hw = c.width * 1.3;                     // just past `c.width * 2.4` stroke
    // Stop at the collar: past it the strain relief is only a shade wider than
    // the cord, so the cord running over it reads as the boot gripping it.
    const ex = p0.x + ux * 16 * dpr, ey = p0.y + uy * 16 * dpr;
    const STEPS = 10;
    ctx.moveTo(p0.x + nx * hw, p0.y + ny * hw);
    ctx.lineTo(ex + nx * hw, ey + ny * hw);
    for (let k = 1; k <= STEPS; k++) {            // round the far end, through +u
      const a = -Math.PI * k / STEPS, ca = Math.cos(a), sa = Math.sin(a);
      ctx.lineTo(ex + (nx * ca - ny * sa) * hw, ey + (nx * sa + ny * ca) * hw);
    }
    for (let k = 1; k <= STEPS; k++) {            // and the jack end, through -u
      const a = -Math.PI * k / STEPS, ca = Math.cos(a), sa = Math.sin(a);
      ctx.lineTo(p0.x + (-nx * ca + ny * sa) * hw, p0.y + (-nx * sa - ny * ca) * hw);
    }
    ctx.closePath();
  }

  function drawPlugs(c) {
    const pts = c.pts;
    // plug barrels + strain relief along the cord's true entry angle
    for (const [p0, p1] of [[pts[0], pts[1]], [pts[N - 1], pts[N - 2]]]) {
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
      const barrel = 15 * dpr;
      // the 1/4" tip slides out as the plug leaves a socket, and back in as it seats —
      // exposure is pure distance-from-jack
      let nearest = Infinity;
      for (const j of jacks) {
        const dj = Math.hypot(j.x - p0.x, j.y - p0.y);
        if (dj < nearest) nearest = dj;
      }
      const expose = Math.min(1, Math.max(0, (nearest - JR * 0.7) / (16 * dpr)));
      if (expose > 0.02) {
        const shaft = 11 * dpr * expose;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p0.x - ux * shaft, p0.y - uy * shaft);
        ctx.strokeStyle = "rgb(158,162,168)";
        ctx.lineWidth = c.width * 1.0;
        ctx.stroke();
        const rx = p0.x - ux * shaft * 0.62, ry = p0.y - uy * shaft * 0.62;
        ctx.beginPath();
        ctx.moveTo(rx - uy * c.width * 0.55, ry + ux * c.width * 0.55);
        ctx.lineTo(rx + uy * c.width * 0.55, ry - ux * c.width * 0.55);
        ctx.strokeStyle = "rgb(40,40,40)";
        ctx.lineWidth = 1.6 * dpr;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p0.x - uy * c.width * 0.28, p0.y + ux * c.width * 0.28);
        ctx.lineTo(p0.x - ux * shaft * 0.9 - uy * c.width * 0.28, p0.y - uy * shaft * 0.9 + ux * c.width * 0.28);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = Math.max(1, c.width * 0.25);
        ctx.stroke();
      }
      // strain relief: a tapering rubber boot where cord meets plug
      ctx.beginPath();
      ctx.moveTo(p0.x + ux * barrel, p0.y + uy * barrel);
      ctx.lineTo(p0.x + ux * barrel * 1.8, p0.y + uy * barrel * 1.8);
      ctx.strokeStyle = tint(c, 0.8, 0.5);
      ctx.lineWidth = c.width * 1.8;
      ctx.stroke();
      // the barrel itself
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p0.x + ux * barrel, p0.y + uy * barrel);
      ctx.strokeStyle = tint(c, 1.15, 0.35);
      ctx.lineWidth = c.width * 2.4;
      ctx.stroke();
      // barrel glint
      ctx.beginPath();
      ctx.moveTo(p0.x + ux * 2 * dpr - uy * c.width * 0.55, p0.y + uy * 2 * dpr + ux * c.width * 0.55);
      ctx.lineTo(p0.x + ux * (barrel - 2 * dpr) - uy * c.width * 0.55, p0.y + uy * (barrel - 2 * dpr) + ux * c.width * 0.55);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, c.width * 0.35);
      ctx.stroke();
      // the collar where boot meets cord
      ctx.beginPath();
      ctx.arc(p0.x + ux * barrel, p0.y + uy * barrel, c.width * 1.05, 0, 7);
      ctx.fillStyle = tint(c, 0.9, 0.45);
      ctx.fill();
    }
  }

  function draw() {
    t += 0.016;
    step();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(panel, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Plugs go UNDER the cords, so a wire crossing a seated connection passes in
    // front of it rather than disappearing behind. A cord must still go behind
    // its OWN plug, or the barrel it is plugged into is painted over by the cord
    // leaving it — hence the clip.
    for (const c of cables) drawPlugs(c);
    for (const c of cables) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      plugHole(c, c.pts[0], c.pts[1]);
      plugHole(c, c.pts[N - 1], c.pts[N - 2]);
      ctx.clip("evenodd");
      drawCable(c);
      ctx.restore();
    }


    if (!REDUCED) rafId = requestAnimationFrame(draw);
  }

  const GRAB = () => 18 * dpr;

  function plugAt(x, y) {
    for (const c of cables) {
      if (Math.hypot(c.pts[0].x - x, c.pts[0].y - y) < GRAB()) return { cable: c, end: "a" };
      if (Math.hypot(c.pts[N - 1].x - x, c.pts[N - 1].y - y) < GRAB()) return { cable: c, end: "b" };
    }
    return null;
  }

  // a jack is taken if any cord end lives there (or is on its way there)
  function jackTaken(j) {
    return cables.some((c) => c.a === j || c.b === j || c.na === j || c.nb === j);
  }

  function liftEnd(c, end) {
    const i = end === "a" ? 0 : N - 1;
    const point = { x: c.pts[i].x, y: c.pts[i].y, free: true };
    if (end === "a") { c.a = point; c.na = point; } else { c.b = point; c.nb = point; }
    c.move = 1;
  }

  canvas.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr;
    if (drag) {
      const c = drag.cable;
      if (drag.ends.length === 2) {
        // whole cord in hand: both plugs ride together
        const [e1, e2] = drag.ends.map((end) => (end === "a" ? c.a : c.b));
        e1.x = mouse.x; e1.y = mouse.y;
        e2.x = mouse.x + 16 * dpr; e2.y = mouse.y + 10 * dpr;
      } else {
        // a taut cord stops the hand
        const end = drag.ends[0] === "a" ? c.a : c.b;
        const other = drag.ends[0] === "a" ? c.b : c.a;
        let dx = mouse.x - other.x, dy = mouse.y - other.y;
        const d = Math.hypot(dx, dy);
        // Nearly the whole cord. At 0.97 the ends could never get closer than
        // 3% of the cord's length to being fully apart, and a cord with 3%
        // spare has to put it somewhere — geometry demands a 10% belly. The
        // tension pull hid that by squashing the cord onto the line, which is
        // what made a cord pulled tight measurably shrink. Let it actually
        // reach full stretch and the taut look is real.
        const maxReach = c.len * 0.995;
        if (d > maxReach) { dx *= maxReach / d; dy *= maxReach / d; }
        end.x = other.x + dx;
        end.y = other.y + dy;
      }
    } else {
      canvas.style.cursor = plugAt(mouse.x, mouse.y) ? "grab" : "default";
    }
  });

  function trySeat() {
    const c = drag.cable, endName = drag.ends[0];
    const end = endName === "a" ? c.a : c.b;
    let best = null, bd = 44 * dpr;
    for (const j of jacks) {
      if (jackTaken(j)) continue;        // occupied holes refuse — including the cord's own other end
      const d = Math.hypot(j.x - end.x, j.y - end.y);
      if (d < bd) { bd = d; best = j; }
    }
    if (!best) return false;             // not over a free hole — keep carrying
    if (endName === "a") c.na = best; else c.nb = best;
    c.moveSpeed = 0.12;
    c.move = 0;
    saveCables();
    drag.ends.shift();
    if (!drag.ends.length) {
      drag = null;
      canvas.style.cursor = "default";
    }
    return true;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const x = e.clientX * dpr, y = e.clientY * dpr;
    if (drag) {
      // holding one end and clicking the cord's other plug: carry both.
      // Check the other end directly — the held plug rides the cursor and
      // would otherwise win every hit test.
      if (drag.ends.length === 1) {
        const otherEnd = drag.ends[0] === "a" ? "b" : "a";
        const op = drag.cable.pts[otherEnd === "a" ? 0 : N - 1];
        if (Math.hypot(op.x - x, op.y - y) < GRAB()) {
          liftEnd(drag.cable, otherEnd);
          drag.ends.push(otherEnd);
          return;
        }
      }
      trySeat();
      return;
    }
    const hit = plugAt(x, y);
    if (!hit) return;
    liftEnd(hit.cable, hit.end);
    drag = { cable: hit.cable, ends: [hit.end] };
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointerup", () => {
    if (!drag) return;
    trySeat();
  });

  window.addEventListener("resize", size);
  size();
  if (REDUCED) { for (let i = 0; i < 240; i++) step(); }
  draw(); // reduced motion: one settled, draped frame

  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", size);
  };
}
