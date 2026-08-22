import { describe, expect, it } from "vitest";

import { relaxBendMemory } from "@/lib/patchbay";

type P = { x: number; y: number };
const N = 16;
const G = 2.3, DAMP = 0.992, BEND_DAMP = 0.15;

const arc = (p: P[]) => {
  let s = 0;
  for (let i = 0; i < N - 1; i++) s += Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
  return s;
};
const sagOf = (p: P[], ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / L, ny = dx / L;
  return Math.max(...p.map((q) => Math.abs((q.x - ax) * nx + (q.y - ay) * ny)));
};
/** Angle between the cord's entry direction and the line between the jacks. */
const tiltOf = (p: P[], ax: number, ay: number, bx: number, by: number) => {
  const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, ul = Math.hypot(ux, uy) || 1e-6;
  const cx = bx - ax, cy = by - ay, cl = Math.hypot(cx, cy) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * cx + uy * cy) / (ul * cl)))) * 180) / Math.PI;
};

/** One cable through the real step loop, including the length controller. */
function run(
  ext: number,
  {
    frames = 3400, stiff = 0.05, fromStraight = false, shoveAt = -1,
    control = true, dragTo = true,
  } = {},
) {
  const len = 270;
  const baseRest = len / (N - 1);
  let restScale = 1;
  const ax = 0, ay = 0, by = 0;
  // Settle slack first, then carry the end out — a cord reaches a given
  // extension by being dragged there, and it brings its corrected length with
  // it. Dropping it in cold measures a state the app never shows.
  let bx = len * (dragTo ? 0.5 : ext);
  const pts: P[] = [], prev: P[] = [], kink: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    pts.push({ x: ax + (bx - ax) * k, y: ay + (fromStraight ? 0 : Math.sin(k * Math.PI) * 20) });
    prev.push({ ...pts[i] });
    kink.push(i === 0 || i === N - 1 ? 0 : Math.sin(k * Math.PI * 3) * 1.5);
  }
  const pin = () => {
    pts[0].x = ax; pts[0].y = ay; pts[N - 1].x = bx; pts[N - 1].y = by;
  };
  const gEff = G * (1 - Math.min(0.25, stiff * 0.9));
  const sags: number[] = [], midX: number[] = [];
  const segMin = new Array(N - 1).fill(Infinity), segMax = new Array(N - 1).fill(-Infinity);
  let rSum = 0, sSum = 0, mSum = 0, tSum = 0, n = 0;

  for (let f = 0; f < frames; f++) {
    if (dragTo) bx = len * (0.5 + (ext - 0.5) * Math.min(1, Math.max(0, (f - 1200) / 30)));
    if (f === shoveAt) for (let i = 1; i < N - 1; i++) prev[i].x = pts[i].x - 3;
    const rest = baseRest * restScale;
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * DAMP, vy = (p.y - q.y) * DAMP + gEff;
      q.x = p.x; q.y = p.y; p.x += vx; p.y += vy;
    }
    pin();
    for (let it = 0; it < 6; it++) {
      for (let s = 0; s < N - 1; s++) {
        const i = it % 2 === 0 ? s : N - 2 - s;
        const p = pts[i], q = pts[i + 1];
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const pFree = i > 0, qFree = i < N - 2;
        const diff = (d - rest) / d / (pFree && qFree ? 2 : 1);
        const ox = dx * diff, oy = dy * diff;
        if (pFree) { p.x += ox; p.y += oy; }
        if (qFree) { q.x -= ox; q.y -= oy; }
      }
      pin();
    }
    relaxBendMemory(pts, prev, kink, Math.min(0.35, stiff * 3), BEND_DAMP, N);
    for (let d = 1; d <= 3; d++) {
      const w = 0.6 * (1 - (d - 1) / 3);
      for (const i of [d, N - 1 - d]) {
        if (i < 1 || i > N - 2) continue;
        prev[i].x += (pts[i].x - prev[i].x) * w;
        prev[i].y += (pts[i].y - prev[i].y) * w;
      }
    }
    // Measured before the pull squashes the cord — see patchbay.ts.
    const arcBeforePull = arc(pts);
    if (control) {
      const a = arcBeforePull;
      if (a > 1e-6) {
        // Rate-capped — see the controller in patchbay.ts.
        const step = (len / a - 1) * 0.05;
        restScale *= 1 + Math.max(-0.0008, Math.min(0.0008, step));
        restScale = Math.max(0.3, Math.min(1.2, restScale));
      }
    }
    if (shoveAt > 0 && f > shoveAt && f <= shoveAt + 160) {
      for (let i = 0; i < N - 1; i++) {
        const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (L < segMin[i]) segMin[i] = L;
        if (L > segMax[i]) segMax[i] = L;
      }
    }
    sags.push(sagOf(pts, ax, ay, bx, by));
    // The middle of the arc, not the average of every point. The points beside
    // each plug are deliberately damped by the strain relief, and averaging
    // them in reports a swing slower than the one you actually watch.
    midX.push(pts[Math.floor(N / 2)].x);
    if (f >= frames - 300) {
      rSum += arc(pts) / len;
      sSum += sagOf(pts, ax, ay, bx, by) / len;
      tSum += tiltOf(pts, ax, ay, bx, by);
      let mv = 0;
      for (let i = 1; i < N - 1; i++) mv += Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y);
      mSum += mv / (N - 2);
      n++;
    }
  }
  const finalSag = (sSum / n) * len;
  const fall = sags.findIndex((s) => s >= finalSag * 0.9);
  let swingAmp = 0, halfCycles = 0, halfPeriod = 0;
  if (shoveAt > 0) {
    const base = midX[shoveAt - 1];
    const after = midX.slice(shoveAt);
    swingAmp = Math.max(...after.slice(0, 80).map((v) => Math.abs(v - base)));
    const cross: number[] = [];
    let sign = Math.sign(after[0] - base);
    for (let i = 1; i < after.length; i++) {
      const sg = Math.sign(after[i] - base);
      if (sg !== 0 && sg !== sign) { cross.push(i); sign = sg; }
    }
    halfCycles = cross.length;
    // Frames between successive passes through rest — the swing's half-period.
    if (cross.length > 2) halfPeriod = (cross[cross.length - 1] - cross[0]) / (cross.length - 1);
  }
  return {
    ratio: rSum / n, sag: sSum / n, tilt: tSum / n, motion: mSum / n,
    fallFrames: fall < 0 ? frames : fall, swingAmp, halfCycles, halfPeriod,
    segSwing: segMax.map((v, i) => v - segMin[i]),
  };
}

const EXTS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95];

describe("cord behaviour", () => {
  it("comes out the length it was cut to, at every extension", () => {
    // The whole point of the controller. A compliant solver stretches in
    // proportion to tension, and tension tracks how far apart the ends are, so
    // uncorrected the cord ran 17% longer at one separation than another — the
    // cord visibly growing and shrinking as an end is dragged.
    // Every extension, including full draw. The tension pull used to squash a
    // stretched cord to 0.966 of its length — it looked taut by being shorter,
    // which is visible as the cord shrinking while you pull it.
    //
    // Half a percent short at the very top of the range is deliberate, and
    // bought something. The controller used to measure the arc AFTER the taut
    // pull had squashed the cord onto its chord, so it read the squash as the
    // cord being short and fed length in, and got squashed again. Near
    // straight, where the arc barely moves however far the cord bows, that
    // chase ran away: a cord left alone at 0.989 extension churned at 1.9
    // px/frame for as long as anyone watched. Measuring before the squash ends
    // it — 0.029 px/frame — and costs a length the pull then takes back. The
    // spread is what a person actually sees, and that is what stays tight: a
    // cord uniformly a hair short looks like a cord, a cord that changes length
    // as you drag its end looks broken.
    const ratios = [...EXTS, 0.97, 0.995].map((e) => run(e).ratio);
    //
    // A little over a percent short at the very top of the range is deliberate,
    // and buys the cord holding still. The controller used to read the arc
    // AFTER the taut pull squashed the cord onto its chord, so it read the
    // squash as the cord being short, fed length in, and got squashed again —
    // and near straight, where arc barely moves however far the cord bows, that
    // chase ran away: 1.9 px/frame on a cord nobody was touching. Reading
    // before the squash ends it and costs a length the pull then takes back.
    //
    // The spread is the part a person sees. A cord uniformly a hair short looks
    // like a cord; a cord that changes length as you drag its end looks broken.
    for (const r of ratios) expect(r).toBeGreaterThan(0.985);
    for (const r of ratios) expect(r).toBeLessThan(1.005);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.015);
  });

  it("does it by moving the target, not by stiffening the cord", () => {
    // If this ever starts passing by making the solver stiff, the drape, the
    // swing and the weight of the fall go with it — that is what happened when
    // substepping was tried. Uncontrolled, the cord must still stretch.
    const loose = EXTS.map((e) => run(e, { control: false }).ratio);
    expect(Math.max(...loose)).toBeGreaterThan(1.05);
  });

  it("falls under gravity without stalling or snapping", () => {
    const fall = run(0.45, { fromStraight: true }).fallFrames;
    expect(fall).toBeGreaterThan(10);
    expect(fall).toBeLessThan(30);
  });

  it("goes slack when the ends are close and taut when they are far", () => {
    const exts = [...EXTS, 0.97, 0.995];
    const sags = exts.map((e) => run(e).sag);
    for (let i = 1; i < sags.length; i++) expect(sags[i]).toBeLessThan(sags[i - 1] + 0.004);
    expect(sags[0]).toBeGreaterThan(0.3);           // ends close: a deep drape
    // Six percent of belly at full draw, not one. The old number came from a
    // pull that dragged a stretched cord onto the line between its jacks, which
    // ironed it flatter than its own length allows — and paid for it twice
    // over: the sag collapsed 3.4x between 0.95 and 0.97 extension, so a cord
    // visibly eased its own slack as you pulled it, and the pull spent the rest
    // of its time fighting the length controller for the same points, leaving
    // the cord shifting on its own at 0.275 and 0.410 px/frame in that same
    // band. What is left is only the length that will not fit between the
    // jacks. It falls off smoothly — 13.6, 10.6, 6.6, 5.7% across 0.95 to
    // 0.995 — and nothing moves that is not being dragged.
    expect(sags[sags.length - 1]).toBeLessThan(0.06); // stretched out: nearly straight
  });

  it("pulls the plug straight when the cord is stretched out", () => {
    // At full draw, where a cord is actually pulled straight — not at 0.97,
    // which is no longer the limit and where a cord legitimately keeps a belly.
    expect(run(0.995).tilt).toBeLessThan(20);
  });

  it("comes to rest at every extension", () => {
    for (const stiff of [0.015, 0.05, 0.09]) {
      for (const ext of [0.5, 0.9, 0.93, 0.95]) {
        expect(run(ext, { stiff }).motion).toBeLessThan(0.8);
      }
    }
  });

  it("stops ringing at the plugs soon after one is moved", () => {
    // Sweep an end back and forth, let go, and watch the points nearest the
    // plugs. Without strain relief they whipped at 5.8px/frame and were still
    // going 70 frames later — one end of a cord bouncing while the other sat
    // still, since only one end gets carried.
    //
    // Measured against TRUE displacement: `pts[i] - prev[i]` is not movement
    // here, because the bend and tension terms both edit `prev`. It reads
    // several px/frame on a cord that is provably motionless.
    const len = 270, baseRest = len / (N - 1);
    let restScale = 1;
    const ax = 0, ay = 0, by = 0;
    let bx = len * 0.62;
    const pts: P[] = [], prev: P[] = [], kink: number[] = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      pts.push({ x: ax + (bx - ax) * k, y: ay + Math.sin(k * Math.PI) * 20 });
      prev.push({ ...pts[i] });
      kink.push(i === 0 || i === N - 1 ? 0 : Math.sin(k * Math.PI * 3) * 1.5);
    }
    const pin = () => {
      pts[0].x = ax; pts[0].y = ay; pts[N - 1].x = bx; pts[N - 1].y = by;
    };
    const gEff = G * (1 - Math.min(0.25, 0.05 * 0.9));
    let last = pts.map((p) => ({ ...p }));
    const D0 = 800, D1 = 920;
    let quiet = -1;
    for (let f = 0; f < 2400; f++) {
      if (f >= D0 && f < D1) {
        const u = (f - D0) / (D1 - D0);
        bx = len * 0.62 + Math.sin(u * Math.PI * 4) * len * 0.25;
      }
      const rest = baseRest * restScale;
      for (let i = 1; i < N - 1; i++) {
        const p = pts[i], q = prev[i];
        const vx = (p.x - q.x) * DAMP, vy = (p.y - q.y) * DAMP + gEff;
        q.x = p.x; q.y = p.y; p.x += vx; p.y += vy;
      }
      pin();
      for (let it = 0; it < 6; it++) {
        for (let s = 0; s < N - 1; s++) {
          const i = it % 2 === 0 ? s : N - 2 - s;
          const p = pts[i], q = pts[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const pFree = i > 0, qFree = i < N - 2;
          const diff = (d - rest) / d / (pFree && qFree ? 2 : 1);
          const ox = dx * diff, oy = dy * diff;
          if (pFree) { p.x += ox; p.y += oy; }
          if (qFree) { q.x -= ox; q.y -= oy; }
        }
        pin();
      }
      relaxBendMemory(pts, prev, kink, Math.min(0.35, 0.05 * 3), BEND_DAMP, N);
      for (let d = 1; d <= 3; d++) {
        const w = 0.6 * (1 - (d - 1) / 3);
        for (const i of [d, N - 1 - d]) {
          if (i < 1 || i > N - 2) continue;
          prev[i].x += (pts[i].x - prev[i].x) * w;
          prev[i].y += (pts[i].y - prev[i].y) * w;
        }
      }
      const a = arc(pts);
      if (a > 1e-6) {
        // No taut pull in this loop, so nothing to aim long for.
        // Rate-capped — see the controller in patchbay.ts.
        const step = (len / a - 1) * 0.05;
        restScale *= 1 + Math.max(-0.0008, Math.min(0.0008, step));
        restScale = Math.max(0.3, Math.min(1.2, restScale));
      }
      if (f > D1) {
        let m = 0;
        for (const i of [1, 2, 3, N - 4, N - 3, N - 2]) {
          m = Math.max(m, Math.hypot(pts[i].x - last[i].x, pts[i].y - last[i].y));
        }
        if (m < 0.05 && quiet < 0) quiet = f - D1;
        else if (m >= 0.05) quiet = -1;
      }
      last = pts.map((p) => ({ ...p }));
    }
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(45);
  });

  it("shares a length change along the cord instead of pumping the last link", () => {
    // The cord is always slightly re-cutting itself: the rest-length controller
    // trims `rest` every frame until the arc matches the length the cord was
    // cut to. That correction has to show up as some scrunch somewhere, and it
    // should be spread thinly down the whole cord.
    //
    // It was not. A distance constraint splits its correction between its two
    // points, but at an end segment one of those points is the plug, which is
    // pinned and throws its half away. So the end links only ever got half a
    // fix, converged at half the rate, and carried everyone else's leftover:
    // measured on the live canvas, the last link breathed 1.8px per settle
    // against 0.4px in the middle, visible as a bounce right at the plug.
    const { segSwing } = run(0.65, { shoveAt: 1400, frames: 1700 });
    const mid = segSwing.slice(4, -4).reduce((a, b) => a + b, 0) / (segSwing.length - 8);
    // Neither end link may breathe much harder than the body of the cord.
    expect(segSwing[0]).toBeLessThan(mid * 2);
    expect(segSwing[segSwing.length - 1]).toBeLessThan(mid * 2);
  });

  it("swings at the speed its own weight says it should", () => {
    // Not just that it moves — how FAST. Bend damping bleeds velocity along the
    // bend normal, and a hanging cord's normal points sideways, so it lands on
    // the swing. It does not merely shrink it, it slows it: at 0.55 the cord
    // barely moved, and at 0.30 a half-swing took 72 frames.
    //
    // A pendulum of this sag has a half-period of pi*sqrt(L/g) — about 21
    // frames at a ~100px sag and g of 2.3 px/frame^2. Anything much longer and
    // the cord is swinging through treacle.
    // At the extension a cord actually rests at (1/slack, around 0.6-0.8), not
    // in a deep U where the midpoint is the bottom of a loop and sways in a
    // different mode entirely.
    const s = run(0.65, { shoveAt: 1400, frames: 2600 });
    const ideal = Math.PI * Math.sqrt(100 / 2.3);
    // Amplitude is the lesser half of it; ~5px at the old damping, ~8 here.
    expect(s.swingAmp).toBeGreaterThan(7);
    expect(s.halfPeriod).toBeGreaterThan(ideal * 0.6);
    expect(s.halfPeriod).toBeLessThan(ideal * 1.6);
  });
});
