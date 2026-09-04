import { expect, it } from "vitest";

import { type Rope3, offPost3 } from "@/lib/patchbay3d";

const rope = (xs: number[], z = 0): Rope3 => ({
  pts: xs.map((x) => ({ x, y: 0, z })), prev: xs.map((x) => ({ x, y: 0, z })),
  r: 4, rest: 10, heldA: false, heldB: false,
});
// a post lying along y at x=50, radius 10: a rope running along y=0 through it
const post = { x0: 50, y0: -20, x1: 50, y1: 20, r: 10 };

it("pushes a board-height rope out of a seated plug's post", () => {
  const r = rope([0, 20, 40, 45, 55, 60, 80]);
  expect(offPost3(r, post, 22)).toBe(4);
  for (const p of r.pts) expect(Math.abs(p.x - 50)).toBeGreaterThanOrEqual(14 - 1e-9);
  expect(r.pts[3].x).toBeLessThan(50);   // each point leaves by the side it was on
  expect(r.pts[4].x).toBeGreaterThan(50);
});

it("ignores a lifted rope and the plug's own barrel points", () => {
  expect(offPost3(rope([45, 55], 26), post, 22)).toBe(0);
  const own = rope([50, 52, 54, 56]);
  expect(offPost3(own, post, 22, 0, 2)).toBe(1);
  expect(own.pts[2].x).toBe(54);
});
