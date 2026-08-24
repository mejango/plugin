import { describe, expect, it } from "vitest";

import {
  type Crossing, type Rope, liftedSeg, segHit, solveCrossings, updateCrossings,
} from "@/lib/patchbay-crossings";

const N = 16;
type P = { x: number; y: number };

/** A straight rope from (x0,y0) to (x1,y1), N points. */
function rope(x0: number, y0: number, x1: number, y1: number, held: Partial<Rope> = {}): Rope {
  const pts: P[] = [], prev: P[] = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    pts.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k });
    prev.push({ ...pts[i] });
  }
  return { pts, prev, width: 8, heldA: false, heldB: false, ...held };
}
const shift = (r: Rope, dx: number, dy: number) => {
  for (let i = 0; i < N; i++) { r.pts[i].x += dx; r.pts[i].y += dy; r.prev[i].x += dx; r.prev[i].y += dy; }
};
/** A U-shaped rope: down from (x0,top), across, back up to (x1,top); bottom at `bottom`. */
function uRope(x0: number, x1: number, top: number, bottom: number): Rope {
  const r = rope(x0, top, x1, top);
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    r.pts[i].y = top + (bottom - top) * Math.sin(k * Math.PI);
    r.prev[i].y = r.pts[i].y;
  }
  return r;
}

describe("segHit", () => {
  it("finds a crossing and its parameters", () => {
    const h = segHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
    expect(h).not.toBeNull();
    expect(h!.t).toBeCloseTo(0.5);
    expect(h!.u).toBeCloseTo(0.5);
  });
  it("misses parallel and non-overlapping segments", () => {
    expect(segHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(segHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -5 }, { x: 20, y: 5 })).toBeNull();
  });
});

describe("liftedSeg", () => {
  it("is the first segment out of a held end, or every segment when both are held", () => {
    const r = rope(0, 0, 100, 0, { heldA: true });
    expect(liftedSeg(r, 0)).toBe(true);
    expect(liftedSeg(r, 1)).toBe(false);
    expect(liftedSeg(r, N - 2)).toBe(false);
    const b = rope(0, 0, 100, 0, { heldB: true });
    expect(liftedSeg(b, N - 2)).toBe(true);
    expect(liftedSeg(b, 0)).toBe(false);
    const both = rope(0, 0, 100, 0, { heldA: true, heldB: true });
    for (let i = 0; i < N - 1; i++) expect(liftedSeg(both, i)).toBe(true);
  });
});

describe("crossing life-cycle", () => {
  it("is born once, over the held rope", () => {
    const A = rope(0, 50, 300, 50, { heldB: true });   // horizontal, held
    const B = rope(150, 0, 150, 100);                   // vertical, at rest
    const xs = updateCrossings([A, B], [], [0, 0], 0);
    expect(xs).toHaveLength(1);
    expect(xs[0].over).toBe(0);
    expect(xs[0].a).toBe(0); expect(xs[0].b).toBe(1);
  });
  it("lands the mover on top when nothing is held", () => {
    const A = rope(0, 50, 300, 50), B = rope(150, 0, 150, 100);
    const xs = updateCrossings([A, B], [], [0, 12], -1);
    expect(xs[0].over).toBe(1);
  });
  it("slides along both ropes as one object", () => {
    const A = rope(0, 50, 300, 50, { heldB: true });
    const B = rope(150, 0, 150, 100);
    let xs = updateCrossings([A, B], [], [0, 0], 0);
    const first = xs[0];
    const ia0 = first.ia;
    for (let f = 0; f < 10; f++) {
      shift(B, 6, 0);           // walk the vertical cord 60px along the horizontal one
      xs = updateCrossings([A, B], xs, [0, 6], 0);
      expect(xs).toHaveLength(1);
      expect(xs[0]).toBe(first);
    }
    expect(first.ia).toBeGreaterThan(ia0);
  });
  it("lets a cord lying over another lift off, but keeps a weave (a cord cannot pass through a cord)", () => {
    const A = rope(0, 50, 300, 50, { heldB: true });
    const B = rope(150, 0, 150, 100);
    let xs = updateCrossings([A, B], [], [0, 0], 0);
    shift(B, 0, 80);            // B now hangs entirely below A: nothing is wound, it lifted off
    xs = updateCrossings([A, B], xs, [0, 80], 0);
    expect(xs).toHaveLength(0);

    const C = rope(0, 50, 300, 50, { heldB: true });
    const D = rope(150, 0, 150, 100);
    let ys = updateCrossings([C, D], [], [0, 0], 0);
    // and a second crossing of the pair the other way round: D is threaded through C
    ys.push({ a: 0, b: 1, ia: 2, ta: 0.5, ib: 2, tb: 0.5, over: 1, linked: true });
    shift(D, 0, 80);
    ys = updateCrossings([C, D], ys, [0, 80], 0);
    expect(ys).toHaveLength(2);
  });
  it("dies when carried clear by a held end", () => {
    const A = rope(0, 50, 300, 50, { heldB: true });
    const B = rope(290, 0, 290, 100);   // crosses A's last segment
    let xs = updateCrossings([A, B], [], [0, 0], 0);
    expect(xs).toHaveLength(1);
    expect(xs[0].ia).toBe(N - 2);
    A.pts[N - 1].y = 200; A.prev[N - 1].y = 200; A.pts[N - 2].y = 120; A.prev[N - 2].y = 120; // hand lifts the end away
    xs = updateCrossings([A, B], xs, [150, 0], 0);
    expect(xs).toHaveLength(0);
  });
  it("stays under a cord when its plug is picked up, and comes out only through the held end", () => {
    const A = rope(0, 50, 300, 50, { heldB: true });
    const B = rope(290, 0, 290, 100);   // over A's last segment
    let xs = updateCrossings([A, B], [], [0, 0], -1);
    xs[0].over = 1;                      // B lay across A's plug
    xs = updateCrossings([A, B], xs, [0, 0], 0);   // A's plug picked up: still under
    expect(xs).toHaveLength(1);
    expect(xs[0].over).toBe(1);
    A.pts[N - 1].x = 240; A.prev[N - 1].x = 240; A.pts[N - 2].x = 250; A.prev[N - 2].x = 250; // drawn clear out from under B
    xs = updateCrossings([A, B], xs, [50, 0], 0);
    expect(xs).toHaveLength(0);
    A.pts[N - 1].x = 300; A.prev[N - 1].x = 300;   // and laid back across it: on top now
    xs = updateCrossings([A, B], xs, [30, 0], 0);
    expect(xs[0].over).toBe(0);
  });
  it("annihilates a bight of two same-over crossings, keeps a mixed pair", () => {
    const line = rope(0, 50, 300, 50);
    const u = uRope(100, 200, 0, 90, );          // dips through the line twice
    let xs = updateCrossings([line, u], [], [0, 5], -1);
    expect(xs).toHaveLength(2);
    expect(xs[0].over).toBe(1); expect(xs[1].over).toBe(1);
    shift(u, 0, -60);                            // pulled back out
    xs = updateCrossings([line, u], xs, [0, 60], -1);
    expect(xs).toHaveLength(0);

    const u2 = uRope(100, 200, 0, 90);
    let ys = updateCrossings([line, u2], [], [0, 5], -1);
    ys[0].over = 0;                              // a real wrap: over, then under
    shift(u2, 0, -60);
    ys = updateCrossings([line, u2], ys, [0, 60], -1);
    expect(ys).toHaveLength(2);
  });
});

describe("touches", () => {
  it("two cords lying along each other are ordered, mover on top, and come apart freely", () => {
    const A = rope(0, 50, 300, 50), B = rope(0, 56, 300, 56);   // 6px apart, width 8
    let xs = updateCrossings([A, B], [], [0, 3], -1);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => !x.linked && x.over === 1)).toBe(true);
    const n = xs.length;
    shift(B, 0, 4);                      // 10px: past touching, within the margin — still known
    xs = updateCrossings([A, B], xs, [0, 4], -1);
    expect(xs).toHaveLength(n);
    shift(B, 0, 40);                     // clean apart: gone, no ring held them
    xs = updateCrossings([A, B], xs, [0, 40], -1);
    expect(xs).toHaveLength(0);
  });
  it("settling births take the side already decided between the pair", () => {
    const A = rope(0, 50, 300, 50), B = rope(150, 0, 150, 100);
    let xs = updateCrossings([A, B], [], [0, 5], -1);        // B on top
    expect(xs[0].over).toBe(1);
    // B folds so it crosses A again, far along A, while A is the one moving
    for (let i = 8; i < N; i++) { B.pts[i].x = 150 + (i - 7) * 20; B.prev[i].x = B.pts[i].x; }
    for (let i = 10; i < N; i++) { B.pts[i].y = 30; B.prev[i].y = 30; }
    xs = updateCrossings([A, B], xs, [9, 0], -1);
    expect(xs.length).toBeGreaterThan(1);
    expect(xs.every((x) => x.over === 1)).toBe(true);
  });
  it("a touch holds nothing in the solver", () => {
    const A = rope(0, 50, 300, 50), B = rope(0, 56, 300, 56);
    const xs = updateCrossings([A, B], [], [0, 3], -1);
    const before = JSON.stringify([A.pts, B.pts]);
    solveCrossings([A, B], xs, 3);
    expect(JSON.stringify([A.pts, B.pts])).toBe(before);
  });
});

describe("solveCrossings", () => {
  const apart = (xs: Crossing[], ropes: Rope[]) => {
    const c = xs[0];
    const at = (r: Rope, i: number, t: number) => ({
      x: r.pts[i].x + (r.pts[i + 1].x - r.pts[i].x) * t,
      y: r.pts[i].y + (r.pts[i + 1].y - r.pts[i].y) * t,
    });
    const p = at(ropes[c.a], c.ia, c.ta), q = at(ropes[c.b], c.ib, c.tb);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  it("pulls a kept crossing back to within half a width, moving prev with pts", () => {
    const A = rope(0, 50, 300, 50), B = rope(150, 0, 150, 100);
    let xs = updateCrossings([A, B], [], [0, 5], -1);
    xs.push({ a: 0, b: 1, ia: 1, ta: 0.5, ib: 14, tb: 0.5, over: 0, linked: true }); // woven
    shift(B, 0, 80);            // B now hangs entirely below A
    xs = updateCrossings([A, B], xs, [0, 80], -1);
    expect(apart(xs, [A, B])).toBeGreaterThan(20);
    const moved = solveCrossings([A, B], xs, 4);
    expect(apart(xs, [A, B])).toBeLessThanOrEqual(A.width / 2 + 0.5);
    expect(moved[0] + moved[1]).toBeGreaterThan(0);
    for (const r of [A, B]) for (let i = 1; i < N - 1; i++) {
      expect(r.pts[i].x - r.prev[i].x).toBeCloseTo(0);
      expect(r.pts[i].y - r.prev[i].y).toBeCloseTo(0);
    }
    // pinned ends never move
    expect(B.pts[0].y).toBe(80); expect(B.pts[N - 1].y).toBe(180);
    expect(A.pts[0].y).toBe(50); expect(A.pts[N - 1].y).toBe(50);
  });
  it("leaves the first segment out of a held end alone — the hand wins", () => {
    const A = rope(0, 50, 300, 50, { heldA: true });
    const B = rope(10, 100, 10, 200);                 // well below A's first segment
    // a crossing pinned on A's lifted first segment, by hand
    const xs: Crossing[] = [{ a: 0, b: 1, ia: 0, ta: 0.5, ib: 7, tb: 0.5, over: 0, linked: true }];
    const a1 = { ...A.pts[1] };
    solveCrossings([A, B], xs, 4);
    expect(A.pts[1]).toEqual(a1);
    expect(B.pts[7].y).toBeLessThan(100 + 100 * 7 / 15);   // B did the moving
  });
});
