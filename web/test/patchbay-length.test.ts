import { describe, expect, it } from "vitest";

import { holdLength, relaxBendMemory } from "@/lib/patchbay";

type P = { x: number; y: number };
const N = 16;
const arc = (p: P[]) => {
  let s = 0;
  for (let i = 0; i < N - 1; i++) s += Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
  return s;
};
const sag = (p: P[], ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / L, ny = dx / L;
  return Math.max(...p.map((q) => Math.abs((q.x - ax) * nx + (q.y - ay) * ny)));
};

/** The full per-frame step for one cable, mirroring step() in patchbay.ts. */
function settle(ext: number, { frames = 2400, stiff = 0.05 } = {}) {
  const len = 270, rest = len / (N - 1);
  const ax = 0, ay = 0, bx = len * ext, by = 0;
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
  const gEff = 2.3 * (1 - Math.min(0.25, stiff * 0.9));
  let worst = 0;
  for (let f = 0; f < frames; f++) {
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * 0.992, vy = (p.y - q.y) * 0.992 + gEff;
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
    relaxBendMemory(pts, prev, kink, Math.min(0.35, stiff * 3), 0.55, N);
    holdLength(pts, prev, len, N, ax, ay, bx, by, 0.25);
    if (f >= frames - 300) worst = Math.max(worst, Math.abs(arc(pts) / len - 1));
  }
  return { worst, sag: sag(pts, ax, ay, bx, by) / len, arcRatio: arc(pts) / len };
}

describe("holdLength", () => {
  it("puts the cord back to exactly its cut length", () => {
    const pts: P[] = [], prev: P[] = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      pts.push({ x: k * 200, y: Math.sin(k * Math.PI) * 60 });
      prev.push({ ...pts[i] });
    }
    holdLength(pts, prev, 270, N, 0, 0, 200, 0, 0.25);
    expect(Math.abs(arc(pts) / 270 - 1)).toBeLessThan(1e-4);
  });

  it("works in both directions — lets a flat cord out and reins a long one in", () => {
    for (const bulge of [2, 200]) {
      const pts: P[] = [], prev: P[] = [];
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1);
        pts.push({ x: k * 200, y: Math.sin(k * Math.PI) * bulge });
        prev.push({ ...pts[i] });
      }
      holdLength(pts, prev, 270, N, 0, 0, 200, 0, 0.25);
      expect(Math.abs(arc(pts) / 270 - 1)).toBeLessThan(1e-4);
    }
  });

  it("leaves the pinned ends alone — the jacks hold those", () => {
    const pts: P[] = [], prev: P[] = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      pts.push({ x: k * 200, y: Math.sin(k * Math.PI) * 60 });
      prev.push({ ...pts[i] });
    }
    const ends = [{ ...pts[0] }, { ...pts[N - 1] }];
    holdLength(pts, prev, 270, N, 0, 0, 200, 0, 0.25);
    expect(pts[0]).toEqual(ends[0]);
    expect(pts[N - 1]).toEqual(ends[1]);
  });

  it("lies flat when the ends are farther apart than the cord is long", () => {
    const pts: P[] = [], prev: P[] = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      pts.push({ x: k * 300, y: Math.sin(k * Math.PI) * 40 });
      prev.push({ ...pts[i] });
    }
    holdLength(pts, prev, 270, N, 0, 0, 300, 0, 0.25);
    expect(sag(pts, 0, 0, 300, 0)).toBeCloseTo(0, 6);
  });

  it("holds length across every extension, in the full step loop", () => {
    // The regression: with only the distance solver, arc/len ran from 0.99 to
    // 1.12 depending on how far apart the ends were — a 13% swing, visible as
    // the cord growing and shrinking as an end is dragged.
    const ratios = [0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.94, 0.99].map((e) => settle(e).arcRatio);
    for (const r of ratios) expect(r).toBeCloseTo(1, 2);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(spread).toBeLessThan(0.005);
  });

  it("still goes slack when the ends are close and taut when they are far", () => {
    // Tautness must remain a consequence of geometry, not of length changing.
    const sags = [0.15, 0.4, 0.7, 0.94, 0.99].map((e) => settle(e).sag);
    for (let i = 1; i < sags.length; i++) expect(sags[i]).toBeLessThan(sags[i - 1]);
    expect(sags[0]).toBeGreaterThan(0.3);       // close ends: a deep drape
    expect(sags[sags.length - 1]).toBeLessThan(0.06); // ends far apart: nearly straight
  });
});
