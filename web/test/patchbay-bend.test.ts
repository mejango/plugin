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

  it("settles the stiffest cord instead of ringing", () => {
    // The full step loop at the stiffest cord in the range (stiff .09 ->
    // stiffNow .27). Correcting the centre alone measured 0.55px/frame still
    // moving after 20s, and stayed there. The calmest cord managed 0.084.
    const n = 16;
    const { pts, prev, kink } = rope(n);
    const rest = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const [ax, ay, bx, by] = [pts[0].x, pts[0].y, pts[n - 1].x, pts[n - 1].y];
    const pin = () => {
      pts[0].x = ax; pts[0].y = ay; pts[n - 1].x = bx; pts[n - 1].y = by;
    };

    let residual = 0;
    const frames = 1200;
    for (let f = 0; f < frames; f++) {
      for (let i = 1; i < n - 1; i++) {
        const p = pts[i], q = prev[i];
        const vx = (p.x - q.x) * 0.992;
        const vy = (p.y - q.y) * 0.992 + 2.3 * (1 - 0.09 * 0.9);
        q.x = p.x; q.y = p.y; p.x += vx; p.y += vy;
      }
      pin();
      for (let it = 0; it < 6; it++) {
        for (let i = 0; i < n - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - rest) / d / 2;
          const ox = dx * diff, oy = dy * diff;
          if (i > 0) { p.x += ox; p.y += oy; }
          if (i < n - 2) { q.x -= ox; q.y -= oy; }
        }
        pin();
      }
      relaxBendMemory(pts, prev, kink, 0.27, 0.55, n);
      if (f >= frames - 60) {
        let s = 0;
        for (let i = 1; i < n - 1; i++) s += Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y);
        residual += s / (n - 2);
      }
    }
    // Below where the calmest cord used to sit, so no style is the restless one.
    expect(residual / 60).toBeLessThan(0.084);
  });
});
