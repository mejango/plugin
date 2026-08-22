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
      for (let i = 0; i < N - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - rest) / d / 2;
        const ox = dx * diff, oy = dy * diff;
        if (i > 0) { p.x += ox; p.y += oy; }
        if (i < N - 2) { q.x -= ox; q.y -= oy; }
      }
      pin();
    }
    relaxBendMemory(pts, prev, kink, Math.min(0.35, stiff * 3), BEND_DAMP, N);
    // The current extension, as step() computes it — not the target.
    const cur = Math.hypot(bx - ax, by - ay) / len;
    let tension = 0;
    if (cur > 0.92) {
      let t2 = Math.min(1, (cur - 0.92) / 0.07);
      t2 = t2 * t2 * (3 - 2 * t2);
      tension = t2 * t2;
    }
    if (tension > 0) {
      const pull = tension * 0.35;
      for (let i = 1; i < N - 1; i++) {
        const k2 = i / (N - 1);
        const tx = ax + (bx - ax) * k2, ty = ay + (by - ay) * k2;
        const pnt = pts[i], q = prev[i];
        pnt.x += (tx - pnt.x) * pull; pnt.y += (ty - pnt.y) * pull;
        q.x += (pnt.x - q.x) * tension; q.y += (pnt.y - q.y) * tension;
      }
    }
    if (control) {
      const a = arc(pts);
      if (a > 1e-6) {
        restScale *= 1 + (len / a - 1) * 0.05;
        restScale = Math.max(0.5, Math.min(1.2, restScale));
      }
    }
    sags.push(sagOf(pts, ax, ay, bx, by));
    let sx = 0;
    for (let i = 1; i < N - 1; i++) sx += pts[i].x;
    midX.push(sx / (N - 2));
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
    const ratios = [...EXTS, 0.97, 0.995].map((e) => run(e).ratio);
    for (const r of ratios) expect(r).toBeCloseTo(1, 2);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.01);
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
    expect(sags[sags.length - 1]).toBeLessThan(0.05); // stretched out: nearly straight
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

  it("swings at the speed its own weight says it should", () => {
    // Not just that it moves — how FAST. Bend damping bleeds velocity along the
    // bend normal, and a hanging cord's normal points sideways, so it lands on
    // the swing. It does not merely shrink it, it slows it: at 0.55 the cord
    // barely moved, and at 0.30 a half-swing took 72 frames.
    //
    // A pendulum of this sag has a half-period of pi*sqrt(L/g) — about 21
    // frames at a ~100px sag and g of 2.3 px/frame^2. Anything much longer and
    // the cord is swinging through treacle.
    const s = run(0.5, { shoveAt: 1400, frames: 2600 });
    const ideal = Math.PI * Math.sqrt(100 / 2.3);
    // Amplitude is the lesser half of it; ~5px at the old damping, ~8 here.
    expect(s.swingAmp).toBeGreaterThan(7);
    expect(s.halfPeriod).toBeGreaterThan(ideal * 0.6);
    expect(s.halfPeriod).toBeLessThan(ideal * 1.6);
  });
});
