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

/** One frame, sub-framed: each sub-frame interpolates the aimed plug a step
 * toward its target and integrates, so nothing — plug or body — leaps far
 * enough to jump across another cord between contact solves. */
function step(ropes: Rope3[], aim: { rope: Rope3; end: "a" | "b"; to: P3 } | null, sub = 1) {
  const held = aim ? (aim.end === "a" ? aim.rope.pts[0] : aim.rope.pts[aim.rope.pts.length - 1]) : null;
  const from = held ? { x: held.x, y: held.y, z: held.z } : null;
  for (let s = 1; s <= sub; s++) {
    for (const r of ropes) integrate3(r, 2.3 / sub, 0.15, 0.99);
    for (const r of ropes) constrainLength3(r, 6);
    if (held && from && aim) {
      const f = s / sub;
      held.x = from.x + (aim.to.x - from.x) * f;
      held.y = from.y + (aim.to.y - from.y) * f;
      held.z = 26;                                   // the held plug is up in the air
      // the cord drapes from the hand down to the board — a real carry rides over
      const r = aim.rope, n = r.pts.length;
      for (let k = 1; k < n - 1; k++) {
        const d = aim.end === "a" ? k : n - 1 - k;   // segments from the held end
        const want = 26 * Math.max(0, 1 - d / 5);
        if (r.pts[k].z < want) r.pts[k].z = want;
      }
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
    for (let i = 0; i < N; i++) { B.pts[i].z = 40; B.prev[i] = { ...B.pts[i] }; }
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

  it("who is on top does not flicker at rest (stable stacking)", () => {
    const A = rope(0, 200, 400, 200);
    const B = rope(200, 0, 200, 400);
    // settle from a small z separation
    for (let i = 0; i < N; i++) { B.pts[i].z = 6; B.prev[i] = { ...B.pts[i] }; }
    for (let f = 0; f < 120; f++) step([A, B], null);
    // read who is higher at the crossing over 60 frames — it must never flip
    const topOf = () => {
      let best = Infinity, top = 0;
      for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
        const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
        if (c.d < best) { best = c.d; top = c.dz >= 0 ? 0 : 1; }
      }
      return top;
    };
    const first = topOf();
    let flips = 0, prev = first;
    for (let f = 0; f < 60; f++) { step([A, B], null); const t = topOf(); if (t !== prev) flips++; prev = t; }
    expect(flips).toBe(0);
  });

  it("an under cord stays under while lifted near its hand (no teleport)", () => {
    // B rests UNDER A at a crossing. We lift B's a-end (as a drag would) and
    // drag it in the plane while it stays caught under A. A real cable cannot
    // climb over the one it is trapped beneath just because we raised its end —
    // it must be pulled clear first. The stack must hold until they separate.
    const A = rope(0, 200, 400, 200);
    const B = rope(200, 60, 200, 400);
    // settle B a touch below A so A is on top
    for (let i = 0; i < N; i++) { B.pts[i].z = 0; B.prev[i] = { ...B.pts[i] }; }
    const stick = new Map<string, number>();
    const stepS = (aim: Parameters<typeof step>[1]) => {
      const held = aim ? (aim.end === "a" ? aim.rope.pts[0] : aim.rope.pts[aim.rope.pts.length - 1]) : null;
      const from = held ? { x: held.x, y: held.y, z: held.z } : null;
      const sub = 8;
      for (let s = 1; s <= sub; s++) {
        for (const r of [A, B]) integrate3(r, 2.3 / sub, 0.15, 0.99);
        for (const r of [A, B]) constrainLength3(r, 6);
        if (held && from && aim) {
          const f = s / sub;
          held.x = from.x + (aim.to.x - from.x) * f;
          held.y = from.y + (aim.to.y - from.y) * f;
          held.z = 26;
          const r = aim.rope, n = r.pts.length;
          for (let k = 1; k < n - 1; k++) {
            const d = aim.end === "a" ? k : n - 1 - k;
            const want = 26 * Math.max(0, 1 - d / 5);
            if (r.pts[k].z < want) r.pts[k].z = want;
          }
        }
        collide3([A, B], 2, stick);
      }
    };
    for (let f = 0; f < 40; f++) stepS(null);          // let A settle on top of B
    const topOf = () => {
      let best = Infinity, dz = 0;
      for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
        const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
        if (c.d < best) { best = c.d; dz = c.dz; }
      }
      return { best, aOverB: dz < 0 };   // dz = zA - zB; A over B when B is lower
    };
    expect(topOf().aOverB).toBe(true);                 // A settled on top
    B.heldA = true;
    // lift B's end and jiggle it around the crossing WITHOUT pulling it clear
    let flips = 0, prev = topOf().aOverB;
    for (let f = 0; f <= 30; f++) {
      const to = { x: 200 + Math.sin(f / 3) * 20, y: 60 - f, z: 0 };  // wander, stay near
      stepS({ rope: B, end: "a", to });
      const t = topOf();
      if (t.best < R * 2 && t.aOverB !== prev) flips++;   // only count while in contact
      prev = t.aOverB;
    }
    expect(flips).toBe(0);                              // A stayed on top the whole time
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
