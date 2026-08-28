import { describe, expect, it } from "vitest";

import {
  type P3, type Rope3, collide3, constrainLength3, integrate3, minPairGap, segClosest3,
} from "@/lib/patchbay3d";

const N = 16;
const R = 8;

function rope(x0: number, y0: number, x1: number, y1: number): Rope3 {
  const pts: P3[] = [], prev: P3[] = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    pts.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, z: 0 });
    prev.push({ ...pts[i] });
  }
  const rest = Math.hypot(x1 - x0, y1 - y0) / (N - 1);
  return { pts, prev, r: R, rest, heldA: false, heldB: false };
}

/** One frame: integrate the free cord, pin/aim the held end, solve. */
function step(ropes: Rope3[], aim: { rope: Rope3; end: "a" | "b"; to: P3 } | null, sub = 1) {
  for (const r of ropes) integrate3(r, 2.3, 0.15, 0.99);
  for (let s = 0; s < sub; s++) {
    for (const r of ropes) constrainLength3(r, 6);
    if (aim) {
      const p = aim.end === "a" ? aim.rope.pts[0] : aim.rope.pts[aim.rope.pts.length - 1];
      p.x = aim.to.x; p.y = aim.to.y; p.z = aim.to.z;
    }
    collide3(ropes, 2);
  }
}

describe("segClosest3", () => {
  it("finds the gap between two crossing segments", () => {
    const c = segClosest3({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: -5, z: 3 }, { x: 5, y: 5, z: 3 });
    expect(c.d).toBeCloseTo(3);
    expect(c.t).toBeCloseTo(0.5);
    expect(c.s).toBeCloseTo(0.5);
  });
});

describe("cords are solid to each other", () => {
  it("a cord laid across another rides up onto it (over/under from z)", () => {
    const A = rope(0, 200, 400, 200);          // horizontal, on the board
    const B = rope(200, 0, 200, 400);          // vertical, crossing it
    B.heldA = B.heldB = true;                    // carried, in the air, laid across
    for (const p of B.pts) p.z = 40;
    for (let i = 0; i < N; i++) B.prev[i] = { ...B.pts[i] };
    B.heldA = B.heldB = false;                   // set it down
    for (let f = 0; f < 300; f++) step([A, B], null);
    // where they cross, one sits about a diameter above the other
    expect(minPairGap(A, B)).toBeGreaterThan(R * 1.2);
  });

  it("never lets a fast-dragged cord pass through another (no tunnel)", () => {
    const A = rope(100, 300, 700, 300);          // the fixed cord
    const B = rope(400, 500, 400, 900);          // dragged by its a-end
    B.heldA = true;
    let worst = Infinity;
    // sweep B's held end straight up across A and out the far side, fast
    for (let f = 0; f <= 60; f++) {
      const to = { x: 400, y: 500 - f * 12, z: 0 };   // 12px/frame, faster than a segment
      step([A, B], { rope: B, end: "a", to }, 8);      // substepped, as a drag is
      worst = Math.min(worst, minPairGap(A, B));
    }
    // A and B still cross somewhere (B ended above A) but never interpenetrated
    expect(worst).toBeGreaterThan(R);                  // combined radius is 2R; a touch is fine, a pass-through is not
  });

  it("holds a wrap: winding a cord's end around a point keeps the cords apart", () => {
    const A = rope(200, 400, 600, 400);          // the cord being wound around
    const B = rope(400, 700, 400, 838);          // wound by its a-end
    B.heldA = true;
    const cx = 400, cy = 400, rad = 40;           // wind a full turn around A's middle
    let worst = Infinity;
    for (let f = 0; f <= 80; f++) {
      const ang = -Math.PI / 2 + (f / 80) * Math.PI * 2;
      const to = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad, z: 0 };
      step([A, B], { rope: B, end: "a", to }, 8);
      if (f > 5) worst = Math.min(worst, minPairGap(A, B));
    }
    expect(worst).toBeGreaterThan(R * 0.8);
  });

  it("a cord does not pass through itself (self-contact)", () => {
    const A = rope(200, 400, 400, 838);
    A.heldA = true;
    // fold the held end back over the cord's own body, fast
    let worst = Infinity;
    for (let f = 0; f <= 40; f++) {
      const to = { x: 300, y: 838 - f * 16, z: 0 };
      step([A], { rope: A, end: "a", to }, 8);
      // self-gap: nearest non-adjacent segments within A
      let m = Infinity;
      for (let i = 0; i < N - 1; i++) for (let j = i + 2; j < N - 1; j++) {
        if (i === 0 && j === N - 2) continue;
        const c = segClosest3(A.pts[i], A.pts[i + 1], A.pts[j], A.pts[j + 1]);
        if (c.d < m) m = c.d;
      }
      if (f > 5) worst = Math.min(worst, m);
    }
    expect(worst).toBeGreaterThan(R * 0.7);
  });
});
