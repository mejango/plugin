// Pure-function properties of the bend constraint. Settling itself is measured
// in patchbay-cord.test.ts, against the real step loop — a copy of that loop
// here drifted out of date the moment substepping landed, and started failing
// on a config the app does not run.
import { describe, expect, it } from "vitest";

import { relaxBendMemory } from "@/lib/patchbay";

type P = { x: number; y: number };

/** A rope pinned at both ends, sagging, with a remembered kink to relax toward. */
function rope(n: number) {
  const pts: P[] = [];
  const kink: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    pts.push({ x: k * 140, y: Math.sin(k * Math.PI) * 20 });
    kink.push(Math.sin(k * Math.PI * 3) * 2.5);
  }
  return { pts, prev: pts.map((p) => ({ ...p })), kink };
}

describe("relaxBendMemory", () => {
  it("spreads each correction across the triple instead of shoving the centre", () => {
    // The regression this guards. Correcting only the centre of each triple
    // left neighbouring points shoving their own middles in opposition, which
    // excites the zig-zag mode between adjacent points — and nothing in the
    // step loop damps it, so the stiffest cords crawled forever.
    //
    // A straight rope has zero bend offset everywhere, so seeding a single
    // remembered kink at the LAST interior point means every earlier index
    // corrects by nothing and only this one triple moves.
    const n = 16;
    const pts: P[] = Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0 }));
    const prev = pts.map((p) => ({ ...p }));
    const kink = new Array(n).fill(0);
    kink[n - 2] = 2;

    const before = pts.map((p) => ({ ...p }));
    relaxBendMemory(pts, prev, kink, 0.27, 0.55, n);

    const moved = pts[n - 2].y - before[n - 2].y;
    const neighbour = pts[n - 3].y - before[n - 3].y;
    expect(moved).not.toBe(0);
    // Half the correction, the other way: that is what conserves momentum.
    expect(neighbour / moved).toBeCloseTo(-0.5, 12);
    // Untouched, because nothing before this triple had anything to correct.
    expect(pts[n - 4]).toEqual(before[n - 4]);
  });

  it("never moves the pinned ends — the jacks hold those", () => {
    const n = 16;
    const { pts, prev, kink } = rope(n);
    const ends = [{ ...pts[0] }, { ...pts[n - 1] }];
    relaxBendMemory(pts, prev, kink, 0.27, 0.55, n);
    expect(pts[0]).toEqual(ends[0]);
    expect(pts[n - 1]).toEqual(ends[1]);
  });

});
