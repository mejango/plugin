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
    // A slack cord hanging vertically folds back on itself until a point's two
    // neighbours nearly touch. The bend normal is taken from the line between
    // those neighbours, so as it collapses its direction is decided by less and
    // less real geometry until it is noise, and the correction jitters the fold
    // forever — measured at 5.8px/frame, still going 500 frames after release,
    // on a cord whose tightest triple had its neighbours 0.5px apart across a
    // 93px segment. Below a fold this tight there is no normal worth having.
    // 2*sin(angle/2) is the ratio, so this is only the last 17 degrees of fold.
    const seg = (Math.hypot(pnt.x - pm.x, pnt.y - pm.y) + Math.hypot(pp.x - pnt.x, pp.y - pnt.y)) / 2;
    if (tl < seg * 0.3) continue;
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

/**
 * Minimum bend radius: a cable cannot fold flat. Past a certain tightness a real
 * one stops closing and curls instead, which is why a patch bay is full of loops
 * and never of creases. Nothing else in the loop resists a fold closing — the
 * bend memory bows a cord about its neighbours but has no opinion on a hairpin,
 * and stands down entirely once one shuts — so a deep loop drew a point at the
 * bottom.
 *
 * The angle is measured between the two vectors from the centre point OUT to its
 * neighbours. Those are a segment long and never collapse, so this stays well
 * defined exactly where the bend normal — taken along the line BETWEEN the
 * neighbours — stops being: at a closed fold that line is nothing but rounding
 * error. Opening the fold is a rotation about the centre point, so it moves no
 * point closer to or further from its neighbour and the length solver has
 * nothing to undo.
 *
 * Which way a nearly shut fold curls cannot come from the geometry either, for
 * the same reason. It comes from the remembered kink, so a fold curls the same
 * way every frame instead of whichever way the last rounding error pointed.
 */
export function openTightFolds(pts, prev, kink, side, n, minCos, relax) {
  for (let i = 1; i < n - 1; i++) {
    const pnt = pts[i], pm = pts[i - 1], pp = pts[i + 1];
    const mFree = i - 1 > 0, pFree = i + 1 < n - 1;
    if (!mFree && !pFree) continue;             // both neighbours are plugs
    const ax = pm.x - pnt.x, ay = pm.y - pnt.y;
    const bx = pp.x - pnt.x, by = pp.y - pnt.y;
    const la = Math.hypot(ax, ay) || 1e-6, lb = Math.hypot(bx, by) || 1e-6;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < minCos) continue;                 // open enough to leave alone
    // Which way to curl has to STAY decided. A fold closing all the way passes
    // through dead straight, where this cross product is zero and its sign is
    // whatever the last rounding error said — so the fold was shoved one way,
    // then the other, at five frames a cycle, with the two arms of the hairpin
    // visibly swapping sides and no sign of ever stopping. Only take a new
    // answer from the geometry while the fold is open enough for the geometry
    // to have one; through the ambiguous part, keep the answer already in hand.
    const cross = (ax * by - ay * bx) / (la * lb);
    if (Math.abs(cross) > 0.2) side[i] = Math.sign(cross);
    else if (!side[i]) side[i] = kink[i] >= 0 ? 1 : -1;
    const s = side[i];
    const open = (Math.acos(minCos) - Math.acos(Math.max(-1, Math.min(1, cos)))) * relax;
    const each = mFree && pFree ? open / 2 : open;
    const swing = (p, q, a) => {               // rotate about pnt, velocity intact
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = p.x - pnt.x, dy = p.y - pnt.y;
      const nxp = pnt.x + dx * ca - dy * sa, nyp = pnt.y + dx * sa + dy * ca;
      q.x += nxp - p.x; q.y += nyp - p.y;
      p.x = nxp; p.y = nyp;
    };
    if (mFree) swing(pm, prev[i - 1], -s * each);
    if (pFree) swing(pp, prev[i + 1], s * each);
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
      // which way each fold has decided to curl; see openTightFolds
      c.foldSide = new Array(N).fill(0);
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

  /**
   * Which cable lies over which. A connector goes INTO its jack, so a cord
   * already lying across that jack is on top of it — you could not plug one in
   * otherwise. A cable that merely passes through therefore sits above a cable
   * that ends there.
   *
   * Scored rather than decided pairwise, because pairwise it has no answer:
   * two cables can each run across the other's jack, and then each would have
   * to be above the other. Counting how many other connectors a cord passes
   * over gives one number per cable, so sorting them can never contradict
   * itself. Cables tangled that way fall back to the order they were dealt in,
   * which is what every pair used to get.
   *
   * Worked out when a cable is dealt or dropped, never mid-flight: recomputing
   * while cords are swinging would have them trade places in front of you.
   */
  let stack = [];
  // frames to wait after a plug lands before working the order out again: the
  // cord is still swinging into place then, and where it ends up is what
  // decides the order. Long enough to have settled, short enough that the
  // change happens while the cord is still moving and takes the eye with it.
  let restacking = 0;
  // and once more when the whole panel has gone quiet, in case a cord drifted
  // across a connector after the last go. Only fires when it changes something,
  // and by then nothing is moving, so it cannot flip mid-swing.
  let allQuiet = false;
  let stirred = false;
  let touching = new Set();   // which cables are resting on which, last time we looked
  let lastMoved = -1;         // whoever was carried, so a fresh contact knows who arrived
  let restack = () => {};

  restack = () => {
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    };
    // Does this cable's cord run across that one's connector? Measured to the
    // cord itself rather than the sixteen points it is drawn through, since
    // those sit ninety device pixels apart and a crossing between two of them
    // would go unnoticed. Both parts have thickness, so the reach is the two
    // half-widths together.
    const crossesPlugOf = (c, o) => {
      const other = cables[o];
      // Only a connector SEATED IN A JACK argues this way. The whole reason a
      // cord across one is above it is that the connector had to go into the
      // hole UNDERNEATH it — and one you are carrying is in no hole at all, so
      // it settles nothing.
      //
      // Counting it meant any cord lying where you happen to be holding your
      // plug pushed your whole cable beneath it: dragging a cord across two
      // others put it under both, when laying it over them is the entire point
      // of dragging it there.
      if (other.move < 1) return false;
      const reach = 20 * dpr + cables[c].width;
      const ends = [[other.pts[0], "a"], [other.pts[N - 1], "b"]];
      for (const [plug, name] of ends) {
        if (drag && drag.cable === other && drag.ends.includes(name)) continue;
        for (let i = 0; i < N - 1; i++) {
          const a = cables[c].pts[i], b = cables[c].pts[i + 1];
          if (segDist(plug.x, plug.y, a.x, a.y, b.x, b.y) < reach) return true;
        }
      }
      return false;
    };
    // Do they lie on each other at all — cord on cord, anywhere?
    //
    // It takes more to break a contact than to make one. Contact is now looked
    // at every frame while a cord is in hand, and a cord grazing another right
    // on the threshold would otherwise flicker in and out of touching — and
    // every re-entry counts as meeting afresh, which is a decision. A margin
    // means only actually coming apart counts as coming apart.
    const touch = (c, o) => {
      const held = touching.has(c + ":" + o);
      const reach = (cables[c].width + cables[o].width) * (held ? 1.7 : 0.95);
      for (let i = 0; i < N - 1; i++) {
        const a = cables[c].pts[i], b = cables[c].pts[i + 1];
        for (let j = 0; j <= N - 1; j++) {
          const q = cables[o].pts[j];
          if (segDist(q.x, q.y, a.x, a.y, b.x, b.y) < reach) return true;
        }
      }
      return false;
    };

    const rank = {};
    stack.forEach((id, z) => { rank[id] = z; });
    const above = cables.map(() => new Set());
    const owes = cables.map(() => 0);
    const nowTouching = new Set();
    // what the cable in hand was just laid on top of
    const carriedOver = new Set();
    const want = (lower, upper) => {
      if (lower === upper || above[lower].has(upper)) return;
      above[lower].add(upper); owes[upper]++;
    };

    for (let c = 0; c < cables.length; c++) {
      for (let o = c + 1; o < cables.length; o++) {
        if (!touch(c, o)) continue;
        const key = c + ":" + o;
        nowTouching.add(key);
        // ALREADY RESTING ON EACH OTHER: leave them as they are. A cord that
        // lies under another does not change its mind while it is still under
        // it — pulling a plug out of its hole and putting it back should not
        // flip the cord above the one draped across it and then back again.
        // The order only gets to change when they come apart and meet afresh.
        if (touching.has(key)) {
          if ((rank[c] ?? c) < (rank[o] ?? o)) want(c, o); else want(o, c);
          continue;
        }
        // MEETING AFRESH: a cord across a connector is above it, because the
        // connector had to go into the hole underneath it.
        const cOverO = crossesPlugOf(c, o);
        const oOverC = crossesPlugOf(o, c);
        if (cOverO && !oOverC) want(o, c);
        else if (oOverC && !cOverO) want(c, o);
        // Neither is lying across the other's hole, so it is simply one cord
        // laid on another: whichever was carried here came to rest on top.
        else if (c === lastMoved) { want(o, c); carriedOver.add(o); }
        else if (o === lastMoved) { want(c, o); carriedOver.add(c); }
        else if ((rank[c] ?? c) < (rank[o] ?? o)) want(c, o);
        else want(o, c);
      }
    }
    touching = nowTouching;

    // lay down whatever owes nothing yet, then whatever that frees, and so on,
    // keeping the order they are in now wherever nothing decides otherwise
    const placed = [], done = cables.map(() => false);
    const byRank = cables.map((_, i) => i).sort((a, b) => (rank[a] ?? a) - (rank[b] ?? b));
    while (placed.length < cables.length) {
      let next = -1;
      for (const i of byRank) if (!done[i] && owes[i] === 0) { next = i; break; }
      // nothing free means a knot — two cords each crossing the other's jack,
      // which cannot be satisfied either way round. Take the first one left and
      // carry on; every constraint that is not part of the knot still holds.
      if (next < 0) for (const i of byRank) if (!done[i]) { next = i; break; }
      done[next] = true;
      placed.push(next);
      for (const up of above[next]) owes[up]--;
    }

    // A knot cannot be satisfied both ways round, so the loop above takes the
    // first cable left and carries on — and what it drops can be the very thing
    // that was just decided. Dragging a cord across two others put it UNDER one
    // of them while the rule had plainly said over: the constraint was made and
    // then thrown away breaking a cycle it happened to be part of.
    //
    // So put it back. Of everything in a knot, the one the hand just moved is
    // the one worth keeping — it is the most recent thing anybody asked for,
    // and the only one they are watching.
    if (lastMoved >= 0 && carriedOver.size) {
      let highest = -1;
      for (const o of carriedOver) highest = Math.max(highest, placed.indexOf(o));
      const at = placed.indexOf(lastMoved);
      if (at >= 0 && at < highest) {
        placed.splice(at, 1);
        placed.splice(highest, 0, lastMoved);
      }
    }
    stack = placed;
  };

  function step() {
    const G = 2.3 * dpr;                // gravity ~9.8 m/s² at this pixel scale
    const DAMP = 0.992;                 // light air drag — cords fall, not float
    // Bend damping bleeds velocity along the bend normal — and a hanging cord's
    // normal points SIDEWAYS, so this lands squarely on the swing. It does not
    // just shrink the swing, it decides whether there is one. Swing a plug and
    // hold it: at 0.15 the middle of the cord crossed its resting place 4 times
    // and only ever moved 6px past it, which on screen is a cord easing into
    // place rather than swinging into it. At 0.06 it crosses 10 times and swings
    // 25px, which is a cord.
    //
    // It went to 0.15 to slow a swing that was too fast, back when it was also
    // standing in for damping a stretched cord. That job belongs to nothing now
    // — the pull that used to shake one about is gone — and the residue it was
    // left holding down is caught by cords sleeping instead. Every extension
    // still comes to rest, and ten random drops leave nothing moving.
    const BEND_DAMP = 0.06;             // see relaxBendMemory
    // Strain relief. A plug's boot grips the cord, so a real cable cannot flap
    // where it enters one — it leaves the connector straight for a centimetre
    // and only then starts to hang. Nothing here modelled that, so the last few
    // points whipped while a plug was carried and went on ringing for over a
    // second after it was set down: one end of every cord bouncing while the
    // other sat still, because only one end was being moved.
    //
    // Damping the points nearest each plug, fading out over three of them, is
    // the whole of it. Settling after a drag drops from 70 frames to 32 and the
    // bounce from 5.8 to 3.8 px/frame, while the middle of the arc — the part
    // that should swing — keeps its travel and comes out closer to a free
    // pendulum than before (29 frames against 41, ideal 21).
    // A cable stops closing a fold somewhere around here and starts curling.
    // High enough and a deep loop is forced into a wide round bight; low enough
    // and an ordinary drape never feels it.
    const FOLD_COS = Math.cos((62 * Math.PI) / 180);
    const FOLD_RELAX = 0.25;
    const STRAIN = 0.6;
    const STRAIN_REACH = 3;

    // A cord that has stopped, stops.
    //
    // Every constraint here settles a cord by moving its points, and the length
    // solver moves points without their `prev`, which is a velocity. So any
    // constraint that never quite agrees with another leaves a trickle of motion
    // behind, and a cord can sit there working at itself with nobody touching
    // it — a knotted one on a fresh panel wandered for as long as it was left.
    // Chasing each of those to zero is chasing every pair of constraints in the
    // loop, and the next one added starts it over.
    //
    // Below a tenth of a pixel a frame nothing is happening that anyone can
    // see, so once a cord has been that quiet for half a second it is left
    // alone entirely until something touches it. Cords do not interact, so
    // there is nothing to wake one but its own plugs moving — which is exactly
    // what `move` and a drag say.
    //
    // Half a second is also what keeps a swinging cord out of this. A cord
    // hangs still for an instant at each end of its swing, but a swing of that
    // sag turns around every 22 frames, so it can never be quiet for 30 unless
    // it has actually finished.
    const SLEEP_BELOW = 0.1 * dpr;      // px per frame, per point
    const SLEEP_AFTER = 30;             // frames of quiet before it is left be

    // A connector is a solid thing standing off the panel, so a cord dragged
    // across one catches on it and bends around rather than sliding through.
    // The barrel is a capsule, not a point: from the face of the jack out to the
    // collar where the boot meets the cord, which is what the cord actually
    // meets side-on.
    // Points, not copied numbers. A barrel is aimed by the cord's own second
    // point, so a swinging cable turns its plugs as it goes — and the cables are
    // solved one after another, so a snapshot taken before the loop is already
    // stale for everything solved after the cable that moved. That showed up as
    // a cord passing through a plug for a single frame while a DIFFERENT cable
    // swung nearby. Read live and every cable meets the panel as it is now.
    const BARREL = 15 * dpr;
    const studs = [];
    cables.forEach((o, oi) => {
      const flying = o.move < 1;
      const ends = [[o.pts[0], o.pts[1], "a"], [o.pts[N - 1], o.pts[N - 2], "b"]];
      for (const [q0, q1, name] of ends) {
        // Only a connector SEATED IN A JACK is in the way of anything. The one
        // in your hand is held off the panel, and one still on its way to a
        // hole is in the air the whole time — neither has a socket behind it,
        // so neither has the gap that catches a cord. They pass over
        // everything.
        //
        // They were obstacles like any other, and the plug in your hand
        // bulldozed cords around the panel ahead of it: sweeping it back across
        // a cord shoved that cord aside instead of passing over it.
        if (flying) continue;
        if (drag && drag.cable === o && drag.ends.includes(name)) continue;
        studs.push({ of: o, oi, at: q0, aim: q1, r: o.width * 1.2, key: oi + name });
      }
    });
    // Only what is UNDERNEATH a connector is stopped by it. A cord lying over
    // one is draped across the top of it, the way it would lie over anything
    // else on the panel, and it has nowhere to be caught — it is already past.
    // A cord underneath has to get between the plug and the socket it is seated
    // in, and there is no room there: that is the one case where a connector is
    // in the way, and the only one worth making a cord fight.
    //
    // Which is which is already settled, by the same stack the drawing uses, so
    // a cord catches on exactly the plugs it visibly runs behind.
    const zOf = new Array(cables.length).fill(0);
    stack.forEach((id, z) => { zOf[id] = z; });
    // Stop a point dead against the barrel: the speed INTO the plug comes off
    // it so it does not bounce away, and what is left running along the barrel
    // is shaved so the cord grips instead of sliding off the end.
    const settleAt = (c, i, nx, ny) => {
      const p = c.pts[i], q = c.prev[i];
      let vx = p.x - q.x, vy = p.y - q.y;
      const vn = vx * nx + vy * ny;
      if (vn < 0) { vx -= nx * vn; vy -= ny * vn; }
      q.x = p.x - vx * 0.82; q.y = p.y - vy * 0.82;
    };
    // Three things to ask of it. ASK moves nothing and answers whether the cord
    // is inside a plug — that is the check for waking one something has been
    // pushed into. LIFT clears it out to the surface. SETTLE also kills the
    // speed going in.
    //
    // A cord is its SEGMENTS, not its points. Testing the points alone leaves
    // the span between two of them free to sit anywhere, and a barrel is far
    // narrower than the gap between two points of a cord — so pulling hard
    // enough slid the cord between them and straight through the plug with
    // nothing ever measuring as inside it.
    const ASK = 0, LIFT = 1, SETTLE = 2;
    const offStuds = (c, mode) => {
      let hit = false;
      const ci = cables.indexOf(c);
      // Where the cord is caught, kept for the drag: a cord hooked on a barrel
      // has to run OUT to the hook and back, which is further than straight
      // across, and the hand has to stop that much sooner.
      if (mode === SETTLE) c.hooks = [];
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const p = c.pts[i];
        if (p.x < bx0) bx0 = p.x;
        if (p.x > bx1) bx1 = p.x;
        if (p.y < by0) by0 = p.y;
        if (p.y > by1) by1 = p.y;
      }
      const on = c.studsOn || (c.studsOn = new Set());
      for (const s of studs) {
        if (s.of === c) continue;
        // Drawn over it: nothing to catch on, and nothing to be let off.
        if (!(zOf[ci] < zOf[s.oi])) { on.delete(s.key); continue; }
        // A cord ALREADY lying over a plug when it becomes the one underneath
        // is left where it is until it has moved clear by itself. Depth can
        // change while nothing has moved: a cable dragged past gets promoted
        // above a third one, and that one is suddenly beneath a connector it
        // has been resting on all along. Enforcing the gap from that instant
        // flung it 20px sideways — a cord jumping because of something that
        // happened to a different cable entirely.
        //
        // So a connector only begins holding a cord off once the two are
        // apart. After that it holds, which is all the catching needs.
        const live = on.has(s.key);
        const R = s.r + c.width * 0.95;
        // where this plug is standing RIGHT NOW, aimed along its own cord
        const hx = s.at.x, hy = s.at.y;
        const adx = s.aim.x - hx, ady = s.aim.y - hy;
        const al = Math.hypot(adx, ady) || 1;
        const vx = (adx / al) * BARREL, vy = (ady / al) * BARREL;
        const vv = vx * vx + vy * vy || 1;
        if (Math.min(hx, hx + vx) - R > bx1 || Math.max(hx, hx + vx) + R < bx0) continue;
        if (Math.min(hy, hy + vy) - R > by1 || Math.max(hy, hy + vy) + R < by0) continue;
        let inside = false;
        for (let i = 0; i < N - 1; i++) {
          const p0 = c.pts[i], p1 = c.pts[i + 1];
          // a plug pinned in a jack cannot be moved out of the way
          const f0 = i > 0, f1 = i < N - 2;
          if (!f0 && !f1) continue;
          const ux = p1.x - p0.x, uy = p1.y - p0.y;
          const uu = ux * ux + uy * uy;

          // Has this stretch of cord been dragged clean across the barrel?
          // Distance cannot answer that — once the cord is out the far side it
          // measures as far from the plug as it does when it is nowhere near.
          const twist = ux * vy - uy * vx;
          if (Math.abs(twist) > 1e-12) {
            const ex = hx - p0.x, ey = hy - p0.y;
            const tc = (ex * vy - ey * vx) / twist;
            const uc = (ex * uy - ey * ux) / twist;
            if (tc > 0 && tc < 1 && uc > 0 && uc < 1) {
              if (!live) { inside = true; continue; }
              if (mode === ASK) return true;
              const qx = -vy / BARREL, qy = vx / BARREL;
              const sideOf = (pt) => (pt.x - hx) * qx + (pt.y - hy) * qy;
              // Which side to put it back on. Normally the side it was on when
              // the frame began — but a stretch ending at a plug has one end
              // that cannot be moved at all, and then the only side both ends
              // can share is the one that end is already on. That is the last
              // place a cord could still be pulled through: the first stretch
              // out of a plug, against the barrel of a cable in the next jack
              // along, where the two sit close enough to foul each other and
              // aiming for the far side could never clear it.
              let sgn;
              if (!f0 && Math.abs(sideOf(p0)) > 1e-9) sgn = sideOf(p0) > 0 ? 1 : -1;
              else if (!f1 && Math.abs(sideOf(p1)) > 1e-9) sgn = sideOf(p1) > 0 ? 1 : -1;
              else {
                const r0 = c.prev[i], r1 = c.prev[i + 1];
                const rx = r0.x + (r1.x - r0.x) * tc, ry = r0.y + (r1.y - r0.y) * tc;
                sgn = vx * (ry - hy) - vy * (rx - hx) >= 0 ? 1 : -1;
              }
              const nx = qx * sgn, ny = qy * sgn;
              // Put the WHOLE stretch back on that side, both ends of it. Lifting
              // just the point that touches by one radius is what let a hard pull
              // win: the cord was 200px long across a 20px barrel, so its far end
              // stayed the wrong side and the stretch went on cutting the plug in
              // half, frame after frame, however many times it was corrected.
              // Two straight pieces cross at most once, so with both ends the
              // same side of the barrel there is no crossing left to have.
              hit = true;
              if (mode === SETTLE) c.hooks.push({ x: hx, y: hy, i });
              if (f0) {
                const sd = (p0.x - hx) * nx + (p0.y - hy) * ny;
                if (sd < R) {
                  p0.x += nx * (R - sd); p0.y += ny * (R - sd);
                  if (mode === SETTLE) settleAt(c, i, nx, ny);
                }
              }
              if (f1) {
                const sd = (p1.x - hx) * nx + (p1.y - hy) * ny;
                if (sd < R) {
                  p1.x += nx * (R - sd); p1.y += ny * (R - sd);
                  if (mode === SETTLE) settleAt(c, i + 1, nx, ny);
                }
              }
              continue;
            }
          }

          // Resting against it: closest approach between this stretch of cord
          // and the barrel, and out to the surface the near way.
          const wx = p0.x - hx, wy = p0.y - hy;
          const b = ux * vx + uy * vy;
          const dw = ux * wx + uy * wy, ew = vx * wx + vy * wy;
          const den = uu * vv - b * b;
          let t = den > 1e-9 ? (b * ew - vv * dw) / den : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          let u = (ew + b * t) / vv;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          t = uu > 1e-9 ? (u * b - dw) / uu : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = p0.x + ux * t, py = p0.y + uy * t;
          const qx = hx + vx * u, qy = hy + vy * u;
          let nx = px - qx, ny = py - qy;
          const d = Math.hypot(nx, ny);
          if (d >= R) continue;
          if (!live) { inside = true; continue; }
          if (mode === ASK) return true;
          // share it along the stretch, so the point nearest where it touches
          // takes most of it and the cord bends around the plug
          const g0 = f0 ? 1 - t : 0, g1 = f1 ? t : 0;
          const spread = g0 * g0 + g1 * g1;
          if (spread < 1e-9) continue;
          hit = true;
          if (d < 1e-6) { nx = -vy / BARREL; ny = vx / BARREL; }
          else { nx /= d; ny /= d; }
          const corr = (R - d) / spread;
          if (g0) { p0.x += nx * corr * g0; p0.y += ny * corr * g0; }
          if (g1) { p1.x += nx * corr * g1; p1.y += ny * corr * g1; }
          if (mode === SETTLE) {
            c.hooks.push({ x: px, y: py, i });
            if (g0) settleAt(c, i, nx, ny);
            if (g1) settleAt(c, i + 1, nx, ny);
          }
        }
        if (!live && !inside && mode === SETTLE) on.add(s.key);
      }
      return hit;
    };
    // Only a plug that is on the move can reach into a cord that has been left
    // alone, and usually none of them is, so this costs nothing while the panel
    // is at rest.
    const anyLive = cables.some((o) => o.move < 1 || (drag && drag.cable === o));

    stirred = false;
    const awake = [];
    for (const c of cables) {
      const busy = c.move < 1 || (drag && drag.cable === c);
      if (busy) c.still = 0;
      else if (c.was) {
        let moved = 0;
        for (let i = 1; i < N - 1; i++) {
          moved = Math.max(moved, Math.hypot(c.pts[i].x - c.was[i].x, c.pts[i].y - c.was[i].y));
        }
        c.still = moved < SLEEP_BELOW ? (c.still || 0) + 1 : 0;
      }
      if (!c.was) c.was = c.pts.map((q) => ({ x: q.x, y: q.y }));
      else for (let i = 0; i < N; i++) { c.was[i].x = c.pts[i].x; c.was[i].y = c.pts[i].y; }
      if (!busy && c.still >= SLEEP_AFTER) {
        if (!anyLive || !offStuds(c, ASK)) continue;
        c.still = 0;
      }
      stirred = true;
      awake.push(c);

      if (c.move < 1) c.move = Math.min(c.move + (c.moveSpeed || 0.012), 1);
      const k = ease(c.move);
      const ax = c.a.x + (c.na.x - c.a.x) * k, ay = c.a.y + (c.na.y - c.a.y) * k;
      const bx = c.b.x + (c.nb.x - c.b.x) * k, by = c.b.y + (c.nb.y - c.b.y) * k;
      if (c.move === 1 && !(drag && drag.cable === c)) {
        if (c.a !== c.na || c.b !== c.nb) { restacking = 40; lastMoved = cables.indexOf(c); }
        c.a = c.na; c.b = c.nb;
      }

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
      // Where the plugs were when the frame began. Nothing else keeps a `prev`
      // for a pinned end — they are not integrated — but the end in your hand
      // is the fastest moving thing on the panel, and the cord beside it needs
      // to know where it swept from.
      c.prev[0].x = c.pts[0].x; c.prev[0].y = c.pts[0].y;
      c.prev[N - 1].x = c.pts[N - 1].x; c.prev[N - 1].y = c.pts[N - 1].y;
      c.pts[0].x = ax; c.pts[0].y = ay;
      c.pts[N - 1].x = bx; c.pts[N - 1].y = by;

      // A cable pulled near straight has no fold left to argue about, and its
      // length is doing all the work. Fade the constraint out as the cord comes
      // tight rather than leaving it to shove points around up there.
      c.foldK = FOLD_RELAX *
        (1 - Math.min(1, Math.max(0, (Math.hypot(bx - ax, by - ay) / c.len - 0.84) / 0.08)));

      for (let iter = 0; iter < 6; iter++) {
        // Inside the solver's own loop, not once before it. Swinging a fold open
        // holds the two segments either side of it but moves that neighbour
        // relative to the point BEYOND it, so the two constraints disagree.
        // Alternating them a frame apart, that disagreement is re-argued every
        // frame — and the solver settles length by moving points without their
        // `prev`, which is a velocity — so a cord near the limit rang for
        // hundreds of frames. Relaxed together, they just converge.
        if (c.foldK > 0) openTightFolds(c.pts, c.prev, c.kinkLocal, c.foldSide, N, FOLD_COS, c.foldK);
        // alternate the sweep direction: a one-way sweep carries its residual
        // outward and dumps the whole length correction at the far plug
        for (let s = 0; s < N - 1; s++) {
          const i = iter % 2 === 0 ? s : N - 2 - s;
          const p = c.pts[i], q = c.pts[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          // share the correction only between the ends that can actually move —
          // halving it against a pinned plug leaves the end segments lagging,
          // so the length correction pools in the last link by the plug
          const pFree = i > 0, qFree = i < N - 2;
          const diff = (d - rest) / d / (pFree && qFree ? 2 : 1);
          const ox = dx * diff, oy = dy * diff;
          if (pFree) { p.x += ox; p.y += oy; }
          if (qFree) { q.x -= ox; q.y -= oy; }
        }
        c.pts[0].x = ax; c.pts[0].y = ay;
        c.pts[N - 1].x = bx; c.pts[N - 1].y = by;
        // Lifted clear on every pass, so the length solver has to route the cord
        // around the plug rather than through it; the pass after this one puts
        // the length back.
        offStuds(c, LIFT);
      }

      relaxBendMemory(c.pts, c.prev, c.kinkLocal, Math.min(0.35, c.stiff * 3), BEND_DAMP, N);

      for (let d = 1; d <= STRAIN_REACH; d++) {
        const w = STRAIN * (1 - (d - 1) / STRAIN_REACH);
        for (const i of [d, N - 1 - d]) {
          if (i < 1 || i > N - 2) continue;
          c.prev[i].x += (c.pts[i].x - c.prev[i].x) * w;
          c.prev[i].y += (c.pts[i].y - c.prev[i].y) * w;
        }
      }

      // Last word on where the cord may be, after bend memory and strain relief
      // have had theirs. Inside the solver alone it was not enough: those two
      // run afterwards and push points back into a plug they had just been
      // lifted out of, and the cord sank 11.6px into the barrel — through it, to
      // look at.
      //
      // More than once, because each plug is answered on its own and lifting a
      // cord off one can lay it across the next; a single pass leaves whatever
      // the last plug did. Speed comes off only at the end, once per frame
      // rather than once per pass, or a cord would stop dead against anything
      // it grazed.
      offStuds(c, LIFT);

      // No pull toward the chord any more, and no tension ramp to drive one.
      //
      // A cord used to be dragged onto the straight line between its jacks once
      // it passed 0.92 extension, to make it read as taut. That was a second
      // mechanism for something the length already decides, and it cost both of
      // the things a stretched cord was still doing wrong. Its onset collapsed
      // the sag 3.4x over two percent of extension — 11.6% at 0.95 down to 3.4%
      // at 0.97 — which is a cord easing its own slack as you pull it. And it
      // fought the rest-length controller for the same points, which left the
      // cord shifting on its own by 0.275 and 0.410 px/frame right in that
      // band, and running away entirely near straight.
      //
      // Sag is now just the length that will not fit between the jacks, and it
      // goes 13.6 -> 10.6 -> 6.6 -> 5.7% across 0.95 to 0.995 with nothing
      // moving on its own: 0.019, 0.008, 0.000, 0.000. A cord holds a slight
      // belly at full draw, as a real one does, instead of being ironed flat.

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
      let arc = 0;
      for (let i = 0; i < N - 1; i++) {
        arc += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y);
      }
      if (arc > 1e-6) {
        // Gentle on purpose: it corrects over a few frames rather than yanking,
        // so a cord being carried is never fighting it.
        //
        // Both directions, at every extension, and now the only thing with an
        // opinion about how straight a cord looks. It used to share that with a
        // pull toward the chord, and the two spent their time undoing each
        // other; with the pull gone it holds 1.000 from slack to 0.97 and drifts
        // only 0.35% at the very top, where six compliant passes stretch the
        // cord further than aiming low can take back.
        // Worked out from where the plugs are, not chased from the cord.
        //
        // Six compliant passes let a cord stretch under its own weight, so the
        // segments have to aim low for it to come out the right length. How low
        // was found by integrating the error, and you could watch it happen:
        // hold a plug still after dragging and the cord went on swelling under
        // your hand for about a second. A cord does not do that. A cord is the
        // length it is.
        //
        // But how far a cord stretches is not a mystery to be searched for. It
        // is set by how hard it is being pulled, which is set by how far apart
        // its plugs are — and measuring across every length and stiffness in
        // the deal, (1 - scale) x length comes out constant at a given
        // extension, and the extension term is 1/sqrt of the slack left. Two
        // numbers, no memory, no lag. Extension depends only on the plugs, so
        // unlike anything read off the cord this cannot answer a swing: the
        // cord may do what it likes underneath it.
        //
        // The fit is good to a percent or two, so a slow trim carries whatever
        // is left — small enough that its own lag is invisible, and gentle
        // enough not to argue with a swinging cord the way the old full-strength
        // version would have.
        const ext = Math.hypot(bx - ax, by - ay) / c.len;
        const slackLeft = Math.max(1 - ext, 0.008);
        const aim = 1 - (15.2 * dpr) / (c.len * Math.sqrt(slackLeft));
        c.trim = Math.max(0.6, Math.min(1.6, (c.trim || 1) * (1 + (c.len / arc - 1) * 0.05)));
        c.restScale = Math.max(0.3, Math.min(1.2, aim * c.trim));
        c.rest = (c.len / (N - 1)) * c.restScale;
      }
    }

    // One more time, now that every cable has finished moving. The cables are
    // solved one after another, so the first one out of the loop was answered
    // against ten cables that had not moved yet — and every crossing left after
    // the fix above was the FIRST cable, whether or not it was the one being
    // dragged, with another cable's plug swinging into it after it was done.
    // Nothing here is stale. Speed comes off on the last pass only.
    //
    // Contact between cables has to be iterated, not swept once. A plug is
    // AIMED by its own cord's second point, so settling one cable turns its
    // connectors, and a cord cleared off one a moment ago can have the barrel
    // rotate straight back into it. Sweeping once left the first cable in the
    // list crossing a plug — always the first, because every other cable moves
    // after it. Each round the rotations get smaller, and three rounds is
    // enough that nothing measurable is left.
    // Contact gets the last word on WHERE the cord may be, but not on what
    // shape it may be left in. The fold limit only ran inside the length
    // solver, and these rounds run after it — so a cord wound round a
    // connector could be left folded to 30 degrees against a 62 degree limit,
    // with nothing after it to open the fold again. That fold is the spike
    // that appeared out of the side of a cord being wound onto a plug.
    for (let pass = 0; pass < 3; pass++)
      for (const c of awake) offStuds(c, LIFT);
    // Once, and gently. Three passes of it flung points about worse than the
    // fold ever did — this is only here to take the corner off a fold that the
    // contact rounds left too tight to be a cord, not to reshape the cord.
    for (const c of awake)
      if (c.foldK > 0)
        openTightFolds(c.pts, c.prev, c.kinkLocal, c.foldSide, N, FOLD_COS, c.foldK * 0.6);
    for (const c of awake) offStuds(c, LIFT);
    for (const c of awake) offStuds(c, SETTLE);
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

  /**
   * The cord's path, optionally shifted sideways by `off` — the sheath, the
   * braid and the sheen are all the same line moved across the cord's width.
   *
   * Sideways means ACROSS THE CORD, not down the screen. This used to add the
   * offset to y, which is the same thing only while a cord runs horizontally:
   * on a vertical one it slid the marking along the cord instead of across it,
   * and around a curl it cut the corner rather than following it. The weave sat
   * rigid inside a cord that was bending, because it was not bending with it.
   */
  function ropePath(pts, off) {
    const m = pts.length;
    const P = off
      ? pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
          const tx = b.x - a.x, ty = b.y - a.y;
          const l = Math.hypot(tx, ty) || 1e-6;
          return { x: p.x - (ty / l) * off, y: p.y + (tx / l) * off };
        })
      : pts;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < m - 1; i++) {
      ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
    }
    ctx.lineTo(P[m - 1].x, P[m - 1].y);
  }

  /**
   * Punch a plug's own footprint out of the current path, tip and barrel both,
   * so the cord diving into it is capped by the connector rather than drawn
   * across it. Shaped to the plug rather than a disc round the jack: a disc big
   * enough to cover the barrel also covers the socket printed on the panel, and
   * the cord would go missing across the whole socket.
   *
   * It reaches BEHIND the jack by `back` to take in the exposed 1/4" tip. Miss
   * that and a pulled plug has its barrel above the cord and its tip below it.
   */
  function plugHole(c, p0, p1, back) {
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
    const nx = -uy, ny = ux;                      // the barrel's half-width axis
    const hw = c.width * 1.3;                     // just past `c.width * 2.4` stroke
    const sx = p0.x - ux * back, sy = p0.y - uy * back;
    // Stop at the collar: past it the strain relief is only a shade wider than
    // the cord, so the cord running over it reads as the boot gripping it.
    const ex = p0.x + ux * 16 * dpr, ey = p0.y + uy * 16 * dpr;
    const STEPS = 10;
    ctx.moveTo(sx + nx * hw, sy + ny * hw);
    ctx.lineTo(ex + nx * hw, ey + ny * hw);
    for (let k = 1; k <= STEPS; k++) {            // round the far end, through +u
      const a = -Math.PI * k / STEPS, ca = Math.cos(a), sa = Math.sin(a);
      ctx.lineTo(ex + (nx * ca - ny * sa) * hw, ey + (nx * sa + ny * ca) * hw);
    }
    for (let k = 1; k <= STEPS; k++) {            // and the tip end, through -u
      const a = -Math.PI * k / STEPS, ca = Math.cos(a), sa = Math.sin(a);
      ctx.lineTo(sx + (-nx * ca + ny * sa) * hw, sy + (-nx * sa - ny * ca) * hw);
    }
    ctx.closePath();
  }

  /**
   * The cord minus the stretch at each end that dives into its own plug —
   * everything far enough out that no plug footprint can reach it.
   *
   * The hole above is geometric: it removes the cord wherever it crosses the
   * plug, not only where it enters. A slack cord whose belly swings back past
   * its own plug lost the belly to that hole and read as threaded behind the
   * connector. Drawing this part again, unclipped and over the top, puts the
   * belly back without letting the cord paint over the plug holding it.
   */
  function cordBody(pts, cut) {
    const n = pts.length;
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (total < cut * 2.5) return null;           // too short to have a free body
    const walk = (from, dir) => {
      let left = cut, i = from;
      for (let g = 0; g < n; g++) {
        const j = i + dir;
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d >= left) return { idx: j, pt: { x: pts[i].x + dx * (left / d), y: pts[i].y + dy * (left / d) } };
        left -= d; i = j;
      }
      return { idx: from + dir, pt: pts[from + dir] };
    };
    const a = walk(0, 1), b = walk(n - 1, -1);
    return a.idx <= b.idx ? [a.pt, ...pts.slice(a.idx, b.idx + 1), b.pt] : [a.pt, b.pt];
  }

  /**
   * The part of a drawn path lying between two arc positions, measured in the
   * whole cord's coordinates — `base` says how far along the cord this array
   * itself starts, since the body pass begins partway out. Ends are cut exactly
   * at the boundary so neighbouring runs share a point and meet cleanly.
   */
  function sliceByArc(pts, base, from, to) {
    const out = [];
    let acc = base;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 1e-6;
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

  /**
   * Where a cord runs back over itself, as arc positions along the given path.
   *
   * A stroke paints its own overlaps flat — one shape, no order — so a cord
   * crossing itself came out as a merged X with the edging running straight
   * through it and neither strand in front. Cutting the path at the crossing
   * puts the two strands in separate strokes, and the later one lands on top
   * the way the far side of a loop should.
   *
   * Only the earlier of the two arc positions is returned: that is the cut that
   * separates them. Segments next to each other share a point and are skipped.
   */
  function selfCrossings(pts) {
    const n = pts.length;
    const arcTo = [0];
    for (let i = 0; i < n - 1; i++) {
      arcTo.push(arcTo[i] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    }
    const cuts = [];
    for (let i = 0; i < n - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      for (let j = i + 2; j < n - 1; j++) {
        const p3 = pts[j], p4 = pts[j + 1];
        const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
        if (Math.abs(d) < 1e-9) continue;
        const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
        const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        cuts.push(arcTo[i] + (arcTo[i + 1] - arcTo[i]) * t);
      }
    }
    return cuts.sort((a, b) => a - b);
  }

  function drawCable(c, pts, shadow, dashFrom) {
    // The body pass redraws over the full cord, so only the first pass casts a
    // shadow — twice and every cord sits on a shadow half again as dark.
    if (shadow) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.16)";
      ctx.shadowBlur = 5 * dpr;
      ctx.shadowOffsetY = 4 * dpr;
    }
    ropePath(pts, 0);
    ctx.strokeStyle = tint(c, 0.9, 0.55);   // dark rubber edge, catches the shadow
    ctx.lineWidth = c.width * 1.9;
    ctx.stroke();
    if (shadow) ctx.restore();
    // the sheath body over the dark edge — the roundness comes from the two tones
    ropePath(pts, -c.width * 0.12);
    ctx.strokeStyle = tint(c, 1);
    ctx.lineWidth = c.width * 1.45;
    ctx.stroke();
    // Dash phase is counted along the path, so a cord that lengthens by a hair
    // walks its whole weave towards one end. Anchored at neither end it crawls
    // in and out under a plug cap; anchored at both, by stroking two halves, the
    // entire change collects at the one point where they meet and the pattern
    // visibly jumps there instead. There is nowhere on the cord to put it.
    //
    // So do not put it anywhere: scale the pattern with the cord's own length,
    // and the same number of weaves spans it however long it is. The phase at
    // both plugs is then fixed for free, no join, and what was a jump at one
    // point becomes every dash in the cord stretching by a fraction of itself.
    // The cord is drawn twice — once clipped, once from the body's start — so
    // the second run is offset by how far along it begins, to stay in step.
    let arc = 0;
    for (let i = 0; i < N - 1; i++) {
      arc += Math.hypot(c.pts[i + 1].x - c.pts[i].x, c.pts[i + 1].y - c.pts[i].y);
    }
    // A cuff at each plug keeps the nominal spacing and never budges; the run
    // between them takes the whole of the cord's stretch. Both joins are made to
    // land on the same phase from either side at any length — the piece in the
    // middle is scaled to hold exactly the number of weaves the gap between the
    // cuffs is supposed to hold — so there is no seam to catch at either one,
    // and what moves does so where there is least to line it up against.
    const CUFF = 0.18 * c.len;
    const roomy = arc > CUFF * 2.4;
    const mid = roomy ? (arc - 2 * CUFF) / (c.len - 2 * CUFF) : arc / c.len;
    const runs = roomy
      ? [{ a: 0, b: CUFF, k: 1, ph: (s) => s },
         { a: CUFF, b: arc - CUFF, k: mid, ph: (s) => CUFF * mid - CUFF + s },
         { a: arc - CUFF, b: arc, k: 1, ph: (s) => c.len - arc + s }]
      : [{ a: 0, b: arc, k: mid, ph: (s) => s }];
    const layer = (pattern, oy, stroke, wide) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, wide);
      for (const r of runs) {
        const sub = sliceByArc(pts, dashFrom, r.a, r.b);
        if (!sub) continue;
        ctx.setLineDash(pattern.map((v) => v * r.k));
        ctx.lineDashOffset = r.ph(Math.max(r.a, dashFrom));
        ropePath(sub, oy);
        ctx.stroke();
      }
    };
    ctx.save();
    // braid wrap: a fine dashed bias line worked along the cord
    layer([2.2 * dpr * c.braid, 3.4 * dpr * c.braid], c.width * 0.18,
          tint(c, 0.5, 0.4), c.width * 0.5);
    // broken sheen: the highlight glints, it doesn't run laser-straight
    layer([9 * dpr * c.braid, 5 * dpr, 4 * dpr * c.braid, 7 * dpr], -c.width * 0.38,
          "rgba(255,255,255," + c.gloss.toFixed(2) + ")", c.width * 0.3);
    ctx.restore();
  }

  /**
   * The two ends of a cable, each with how far its 1/4" tip has slid out of the
   * socket — exposure is pure distance-from-jack. 0 is seated, 1 is fully out.
   * It sets how far the tip sticks out, and nothing else: the tip sliding away
   * into the socket is the whole of what "plugged in" looks like. Layering does
   * not read it, so nothing jumps in front of anything when a plug is dropped.
   */
  function plugEnds(c) {
    const pts = c.pts;
    return [[pts[0], pts[1]], [pts[N - 1], pts[N - 2]]].map(([p0, p1]) => {
      let nearest = Infinity;
      for (const j of jacks) {
        const dj = Math.hypot(j.x - p0.x, j.y - p0.y);
        if (dj < nearest) nearest = dj;
      }
      return { p0, p1, expose: Math.min(1, Math.max(0, (nearest - JR * 0.7) / (16 * dpr))) };
    });
  }

  function drawPlug(c, p0, p1, expose) {
    {
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
      const barrel = 15 * dpr;
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
    // One rule, and picking a plug up or putting it down does not change it: a
    // plug is drawn over its OWN cord and under every other one. Capping its own
    // cord is what makes it read as a connector rather than a bulge in the cord;
    // every other cord passing in front is what keeps a jack reachable even where
    // a cord runs across it, and what stops a cord being sandwiched between a
    // plug and the socket it sits in. Since it never changes, letting go of a
    // plug never flips it behind anything.
    // Redraw a path in pieces, cut where it runs back over itself, so the far
    // side of a loop lands on the near side rather than merging into it. Costs
    // nothing on a cord that does not cross itself, which is nearly all of them.
    // Which end wins is a choice: normally the far end of the cord, but the end
    // in your hand has been lifted off the panel and everything of that cord
    // passes under it, its own far side included. Reversing the pieces is the
    // whole of it — the cuts are already in the right places, and because a
    // piece only ever lands on identical pixels of the same cord there is no
    // seam to see. Restroking an arbitrary length near the hand instead, which
    // is what this did before, cuts the cord where nothing crosses and the join
    // shows as a step in the weave.
    const inPieces = (c, pts, baseArc, flip) => {
      const cuts = selfCrossings(pts);
      if (!cuts.length) return;
      const pieces = [];
      let from = 0;
      for (const at of [...cuts, Infinity]) {
        pieces.push([from, at === Infinity ? 1e9 : at]);
        from = at;
      }
      if (flip) pieces.reverse();
      for (const [a, b] of pieces) {
        const piece = sliceByArc(pts, 0, a, b);
        if (piece) drawCable(c, piece, false, baseArc + a);
      }
    };

    const ends = cables.map(plugEnds);
    const plugsOf = (i) =>
      ends[i].forEach((e) => drawPlug(cables[i], e.p0, e.p1, e.expose));
    // Each cord start to finish before the next one begins, so which of two
    // cords is in front is the same the whole way along where they overlap.
    //
    // These were two sweeps: every cord's ends, then every cord's middle. That
    // put a cord's ends in a lower layer than its own middle, so where one cord
    // crossed another near a plug the two swapped over partway along and the
    // change of order was plainly visible — one cord in front for the last
    // stretch into the plug and behind for the rest of it. Nothing about a cord
    // lying across another changes along its length, so nothing in how they are
    // drawn should either.
    const cordOf = (i, flip) => {
      const c = cables[i];
      // Punched out of its own plugs, so the barrel and tip cap the cord rather
      // than the cord being drawn across them.
      // One connector per clip, not both in one path. Even-odd counts crossings,
      // so two holes in the same path CANCEL where they overlap and that patch
      // comes back — which is exactly what happens when a cord's own two ends
      // are brought together, and the cord was then drawn straight across both
      // connectors in a lens the shape of their overlap. Clips intersect, and
      // the intersection of two complements is the complement of the union, so
      // taking one hole at a time removes both however they lie.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      plugHole(c, c.pts[0], c.pts[1], 11 * dpr * ends[i][0].expose);
      ctx.clip("evenodd");
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      plugHole(c, c.pts[N - 1], c.pts[N - 2], 11 * dpr * ends[i][1].expose);
      ctx.clip("evenodd");
      drawCable(c, c.pts, true, 0);
      inPieces(c, c.pts, 0, flip);
      ctx.restore();
      // That hole is geometric, so a slack cord whose belly swings back past its
      // own plug loses the belly to it. Lay the free body over the top — same
      // cord, same turn, so no other cord can get between the two.
      const cut = 22 * dpr + c.width * 1.3;
      const body = cordBody(c.pts, cut);
      if (body) {
        drawCable(c, body, false, cut);
        inPieces(c, body, cut, flip);
      }
    };

    // The cord in your hand goes last, over the lot of it — cords, plugs and
    // all. Everything else on the panel is lying on the panel; that one has been
    // picked up off it, and drawing it in the fixed order let another cord, or
    // another cord's connector, cover the thing being moved.
    const held = drag ? cables.indexOf(drag.cable) : -1;
    // While a cord is IN HAND, work the contacts out every frame. Both the
    // triggers below wait for the hand to be empty, so for the whole of a drag
    // the record of what was resting on what stood still — and a cord lifted
    // clear of another and laid back across it still counted as never having
    // left. It came back down underneath, because as far as this was concerned
    // it had been under the whole time. Separating them is the whole point of
    // the gesture, so it has to be noticed as it happens.
    if (drag) {
      lastMoved = cables.indexOf(drag.cable);
      restack();
    }
    if (restacking > 0 && !drag && --restacking === 0) restack();
    if (!stirred && !drag && !allQuiet) { allQuiet = true; restack(); }
    else if (stirred) allQuiet = false;
    if (stack.length !== cables.length) restack();
    const grabbedA = held >= 0 && drag.ends.includes("a");
    const bothEnds = held >= 0 && drag.ends.length > 1;
    const endOf = (isA) => ends[held][isA ? 0 : 1];
    // A whole cable at a time — its connectors and then its cord — so a cable
    // has ONE depth against another cable, all of it.
    //
    // These were two sweeps as well: every cable's plugs, then every cable's
    // cords. That put every cord above every plug while the cords were ordered
    // among themselves, so of any two cables the lower one ran UNDER the other's
    // cord and OVER the other's connector. Half of a cord in front and half
    // behind, which is the same fault as before one layer up.
    //
    // The cable in your hand is drawn HERE too, in its own place in the order,
    // not lifted over the rest. Lifting it meant a cord resting under another
    // flipped above it the instant you took hold of the plug, and dropped back
    // under the moment you let go — twice for a move that changed nothing about
    // which cord was lying on which. Whether one cable is over another is
    // settled by them meeting, in `restack`, not by which one you happen to be
    // touching.
    stack.forEach((i) => {
      if (i !== held) { plugsOf(i); cordOf(i); return; }
      const c = cables[i];
      if (bothEnds) { plugsOf(i); cordOf(i); return; }
      // Its own parts still stack by what is in the air: the connector still in
      // its hole, then the cord — running under itself from the hand end back,
      // since that end is the one lifted — and the connector in your hand last.
      const far = endOf(!grabbedA);
      drawPlug(c, far.p0, far.p1, far.expose);
      cordOf(i, grabbedA);
      const hand = endOf(grabbedA);
      drawPlug(c, hand.p0, hand.p1, hand.expose);
    });

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
        //
        // Caught on a connector, the cord no longer runs straight from one plug
        // to the other: it runs out to whatever it is hooked on and back. That
        // path is longer than the gap it spans, so the hand has to stop sooner
        // — measured from the hook, with only what is left of the cord after
        // reaching it. Without this the hand kept going, the cord ran out of
        // length, and the catch tore loose and snapped clear rather than
        // holding taut where it was caught.
        let anchor = other, spare = c.len * 0.995;
        const hooks = c.hooks || [];
        if (hooks.length) {
          // the one nearest the end in your hand, counted along the cord
          let near = null;
          for (const k of hooks) {
            const along = drag.ends[0] === "a" ? k.i : N - 2 - k.i;
            if (!near || along < near.along) near = { along, k };
          }
          const h = near.k;
          // How much cord is already spent getting from the far plug to the
          // hook — along the cord itself, not straight across. A cord curves,
          // so measuring the short way says there is more left than there is,
          // and the hand is let out too far by exactly the difference.
          let run = 0;
          if (drag.ends[0] === "a") {
            for (let k = h.i + 1; k < N - 1; k++)
              run += Math.hypot(c.pts[k+1].x - c.pts[k].x, c.pts[k+1].y - c.pts[k].y);
            run += Math.hypot(h.x - c.pts[h.i + 1].x, h.y - c.pts[h.i + 1].y);
          } else {
            for (let k = 0; k < h.i; k++)
              run += Math.hypot(c.pts[k+1].x - c.pts[k].x, c.pts[k+1].y - c.pts[k].y);
            run += Math.hypot(h.x - c.pts[h.i].x, h.y - c.pts[h.i].y);
          }
          anchor = h;
          spare = Math.max(12 * dpr, c.len * 0.995 - run);
          dx = mouse.x - anchor.x; dy = mouse.y - anchor.y;
        }
        const d2 = Math.hypot(dx, dy) || 1e-6;
        if (d2 > spare) { dx *= spare / d2; dy *= spare / d2; }
        let ex = anchor.x + dx, ey = anchor.y + dy;
        // Caught, the plug moves at a walk. Where the cord is hooked is worked
        // out afresh every frame, and on the turn of a wind it flickers between
        // one hook and none — which moves the anchor, and with it the plug, in
        // a jump. Measured at 31.7px in a single frame while winding a cord
        // onto a connector. Nothing is holding a real plug still, but nothing
        // teleports it either: cap what one frame can move it, and a cord being
        // wound tighter simply budges less and less.
        {
          const cur = drag.ends[0] === "a" ? c.pts[0] : c.pts[N - 1];
          const mx = ex - cur.x, my = ey - cur.y;
          const md = Math.hypot(mx, my);
          // Caught, a plug moves at a walk. Free, it still cannot teleport.
          // Where a cord is hooked is worked out afresh every frame, and on
          // the turn of a wind it flickers between one hook and none — which
          // moves the anchor, and the plug with it, in a single jump. The
          // loose cap is well above any speed a hand actually drags at, so it
          // never lags; it is only there so a change of anchor cannot fling
          // the plug across the panel.
          const STEP = (hooks.length ? 12 : 60) * dpr;
          if (md > STEP) { ex = cur.x + (mx / md) * STEP; ey = cur.y + (my / md) * STEP; }
        }
        end.x = ex;
        end.y = ey;
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
