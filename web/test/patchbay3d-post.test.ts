import { expect, it } from "vitest";

import { type Rope3, offPost3 } from "@/lib/patchbay3d";

// a rope along y=0; `was` is where it came from (prev), `now` where it is
const rope = (was: number[], now = was, z = 0): Rope3 => ({
  pts: now.map((x) => ({ x, y: 0, z })), prev: was.map((x) => ({ x, y: 0, z })),
  r: 4, rest: 10, heldA: false, heldB: false,
});
// a post lying along y at x=50, radius 10, so the rope must stay 14 from x=50
const post = { x0: 50, y0: -20, x1: 50, y1: 20, r: 10 };
const leftOf = (r: Rope3, i: number) => expect(r.pts[i].x).toBeLessThanOrEqual(50 - 14 + 1e-9);

it("pushes a stretch that pressed into the post back out the way it came", () => {
  const r = rope([0, 20, 30, 20, 0], [0, 20, 42, 20, 0]);   // point 2 came from the left, sank 6 in
  expect(offPost3(r, post, 22)).toBeGreaterThan(0);
  for (let k = 0; k < 4; k++) offPost3(r, post, 22);
  leftOf(r, 2);
});

it("sends a stretch that was dragged through the post back to its own side", () => {
  const r = rope([0, 20, 30, 20, 0], [0, 20, 58, 20, 0]);   // now 8 PAST the axis; the nearer side would be the far one
  for (let k = 0; k < 4; k++) offPost3(r, post, 22);
  leftOf(r, 2);
});

it("blocks a stretch whose two points straddle the post", () => {
  const r = rope([0, 20, 34, 30, 0], [0, 20, 36, 64, 0]);   // 36 and 64 are both clear; the stretch between cuts through
  expect(offPost3(r, post, 22)).toBeGreaterThan(0);
  for (let k = 0; k < 6; k++) offPost3(r, post, 22);
  leftOf(r, 2); leftOf(r, 3);
});

it("ignores a lifted rope and the plug's own barrel", () => {
  expect(offPost3(rope([45, 55], undefined, 26), post, 22)).toBe(0);
  const own = rope([50, 52, 54, 56]);
  expect(offPost3(own, post, 22, 0, 2)).toBe(1);   // only the stretch 2->3 is tested
});
