import { describe, expect, it } from "vitest";

import { relaxBendMemory } from "@/lib/patchbay";

type P = { x: number; y: number };
const N = 16;
const G = 2.3, DAMP = 0.992, SUB = 4, SUB_DAMP = Math.pow(DAMP, 1 / SUB);

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
/** Angle between the cord's entry direction and the straight line between jacks. */
const tiltOf = (p: P[], ax: number, ay: number, bx: number, by: number) => {
  const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, ul = Math.hypot(ux, uy) || 1e-6;
  const cx = bx - ax, cy = by - ay, cl = Math.hypot(cx, cy) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * cx + uy * cy) / (ul * cl)))) * 180) / Math.PI;
};

/** One cable through the real step loop: substeps, solver, bend memory, taut. */
function run(
  ext: number,
  { frames = 2400, stiff = 0.05, fromStraight = false, shoveAt = -1 } = {},
) {
  const len = 270, rest = len / (N - 1);
  const ax = 0, ay = 0, bx = len * ext, by = 0;
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
  const gSub = gEff / (SUB * SUB);
  let taut = 0, tautBleed = 0;
  if (ext > 0.92) {
    const t = Math.min(1, (ext - 0.92) / 0.07);
    const ramp = t * t * (3 - 2 * t);
    const tension = ramp * ramp;
    taut = (tension * 0.5) / SUB;
    tautBleed = tension;
  }
  const sags: number[] = [], midX: number[] = [];
  let rSum = 0, sSum = 0, mSum = 0, tSum = 0, n = 0;

  for (let f = 0; f < frames; f++) {
    // A sideways shove, once the cord has settled, to measure the swing.
    if (f === shoveAt) for (let i = 1; i < N - 1; i++) prev[i].x = pts[i].x - 3;
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i], q = prev[i];
      q.x = p.x - (p.x - q.x) / SUB; q.y = p.y - (p.y - q.y) / SUB;
    }
    for (let s = 0; s < SUB; s++) {
      for (let i = 1; i < N - 1; i++) {
        const p = pts[i], q = prev[i];
        const vx = (p.x - q.x) * SUB_DAMP, vy = (p.y - q.y) * SUB_DAMP + gSub;
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
      if (taut > 0) {
        for (let i = 1; i < N - 1; i++) {
          const k2 = i / (N - 1);
          const tx = ax + (bx - ax) * k2, ty = ay + (by - ay) * k2;
          const pnt = pts[i], q = prev[i];
          pnt.x += (tx - pnt.x) * taut; pnt.y += (ty - pnt.y) * taut;
          q.x += (pnt.x - q.x) * tautBleed; q.y += (pnt.y - q.y) * tautBleed;
        }
      }
    }
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i], q = prev[i];
      q.x = p.x - (p.x - q.x) * SUB; q.y = p.y - (p.y - q.y) * SUB;
    }
    relaxBendMemory(pts, prev, kink, Math.min(0.35, stiff * 3), 0.7, N);
    sags.push(sagOf(pts, ax, ay, bx, by));
    let sx = 0;
    for (let i = 1; i < N - 1; i++) sx += pts[i].x;
    midX.push(sx / (N - 2));
    if (f >= frames - 300) {
      rSum += arc(pts) / len;
      let mv = 0;
      for (let i = 1; i < N - 1; i++) mv += Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y);
      mSum += mv / (N - 2);
      sSum += sagOf(pts, ax, ay, bx, by) / len;
      tSum += tiltOf(pts, ax, ay, bx, by);
      n++;
    }
  }
  const finalSag = (sSum / n) * len;
  const fall = sags.findIndex((s) => s >= finalSag * 0.9);
  let swingAmp = 0, halfCycles = 0;
  if (shoveAt > 0) {
    const base = midX[shoveAt - 1];
    const after = midX.slice(shoveAt);
    swingAmp = Math.max(...after.slice(0, 60).map((v) => Math.abs(v - base)));
    let sign = Math.sign(after[0] - base);
    for (let i = 1; i < Math.min(after.length, 400); i++) {
      const sg = Math.sign(after[i] - base);
      if (sg !== 0 && sg !== sign) { halfCycles++; sign = sg; }
    }
  }
  return {
    ratio: rSum / n, sag: sSum / n, tilt: tSum / n, motion: mSum / n,
    fallFrames: fall < 0 ? frames : fall, swingAmp, halfCycles,
  };
}

const EXTS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];

describe("cord behaviour", () => {
  it("keeps its length roughly fixed however far apart the ends are", () => {
    // A compliant solver stretches in proportion to tension, and tension tracks
    // end separation — the cord visibly grew and shrank as an end was dragged.
    // One big step spanned 16%; four substeps bring it under 5%.
    // Measured below the tension ramp, so this is the solver's own stretch and
    // not the deliberate compression that makes a stretched cord look taut.
    const ratios = EXTS.filter((e) => e <= 0.85).map((e) => run(e).ratio);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(spread).toBeLessThan(0.03);
  });

  it("falls under gravity without stalling or snapping", () => {
    // The guard this file exists for. An earlier fix pinned length exactly by
    // rescaling the cord every frame, which made it snap into shape in 5 frames
    // — correct on paper, and read as broken gravity.
    //
    // The window is wide on purpose. It sat at 22 frames while bend damping bled
    // absolute velocity, which dragged on the fall as much as on the swing;
    // damping relative velocity instead put it back near 10, which is what the
    // gravity constant was originally tuned against. Both are fine to look at.
    // What is not fine is either end: a snap, or a cord that never gets there.
    const fall = run(0.45, { fromStraight: true }).fallFrames;
    expect(fall).toBeGreaterThan(7);
    expect(fall).toBeLessThan(30);
  });

  it("goes slack when the ends are close and taut when they are far", () => {
    const sags = EXTS.map((e) => run(e).sag);
    for (let i = 1; i < sags.length; i++) expect(sags[i]).toBeLessThan(sags[i - 1] + 0.004);
    expect(sags[0]).toBeGreaterThan(0.3);
    expect(sags[sags.length - 1]).toBeLessThan(0.03);
  });

  it("pulls the plug straight when the cord is stretched out", () => {
    // "The plug stays tilted up a bit": the cord entering at a steep angle to
    // the line between jacks reads as never quite going taut.
    expect(run(0.97).tilt).toBeLessThan(18);
  });

  it("comes to rest at every extension, including mid-tension", () => {
    // The squiggle. The tension pull used to land once a frame, at full
    // strength, against a length solver running four times as often — they
    // traded shoves forever, worst right where the ramp is partway in. Applying
    // a quarter of the pull inside each substep lets them settle together.
    for (const stiff of [0.015, 0.05, 0.09]) {
      for (const ext of [0.9, 0.93, 0.95, 0.97]) {
        expect(run(ext, { stiff }).motion).toBeLessThan(0.25);
      }
    }
  });

  it("swings freely when shoved sideways", () => {
    // The guard for this one. Bend damping used to bleed a point's ABSOLUTE
    // velocity along the bend normal — and a hanging cord's normal points
    // sideways, so it took the swing out with the wobble: a shoved cord moved
    // 4.5px and never oscillated once. Damping the velocity relative to the
    // neighbours leaves bulk motion alone, because neighbours carry it too.
    const s = run(0.45, { shoveAt: 1200 });
    expect(s.swingAmp).toBeGreaterThan(8);
    expect(s.halfCycles).toBeGreaterThan(10);
  });

  it("behaves the same across the stiffness range", () => {
    for (const stiff of [0.015, 0.05, 0.09]) {
      const ratios = EXTS.filter((e) => e <= 0.85).map((e) => run(e, { stiff }).ratio);
      expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.03);
      expect(run(0.97, { stiff }).tilt).toBeLessThan(18);
    }
  });
});
