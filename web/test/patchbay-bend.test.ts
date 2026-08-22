// Pure-function properties of the bend constraint. Settling itself is measured
// in patchbay-cord.test.ts, against the real step loop — a copy of that loop
// here drifted out of date the moment substepping landed, and started failing
// on a config the app does not run.
import { describe, expect, it } from "vitest";

import { openTightFolds, relaxBendMemory } from "@/lib/patchbay";

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


  it("leaves a triple alone once the fold closes on itself", () => {
    // A slack cord hanging vertically folds back until a point's two neighbours
    // nearly touch. The bend normal is taken from the line between those
    // neighbours, so as the fold closes its direction rests on less and less
    // real geometry until it is rounding error — and the correction jitters the
    // fold forever. Two cords in a seeded panel did exactly that: 5.8 and 2.0
    // px/frame, still going 500 frames after release, while every cord that was
    // not vertical sat at a flat 0.
    //
    // A fold this tight has no normal worth having, so nothing should happen.
    const fold = (gap: number) => {
      const pts: P[] = [
        { x: 0, y: 0 },
        { x: 50, y: 0 },     // the point being corrected
        { x: gap, y: 0 },    // its far neighbour, folded back onto the near one
      ];
      const before = { ...pts[1] };
      relaxBendMemory(pts, pts.map((q) => ({ ...q })), [0, 8, 0], 0.3, 0.15, 3);
      return Math.hypot(pts[1].x - before.x, pts[1].y - before.y);
    };
    // Neighbours a hair apart against a 50px segment: no correction at all.
    expect(fold(0.5)).toBe(0);
    // An open corner is ordinary geometry and must still be corrected.
    expect(fold(90)).toBeGreaterThan(0.5);
  });

  describe("openTightFolds", () => {
    const MIN = Math.cos((62 * Math.PI) / 180);
    const angleAt = (pts: P[], i: number) => {
      const a = { x: pts[i - 1].x - pts[i].x, y: pts[i - 1].y - pts[i].y };
      const b = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
      const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
      return (Math.acos((a.x * b.x + a.y * b.y) / (la * lb)) * 180) / Math.PI;
    };
    const seg = (pts: P[], i: number) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);

    it("opens a hairpin rather than letting it close to a point", () => {
      // Nothing else in the loop objects to a fold shutting: bend memory bows a
      // cord about its neighbours but has no opinion on a hairpin, and stands
      // down entirely once one closes. A deep loop drew a point at the bottom.
      const pts: P[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 200 }, { x: 10, y: 100 }, { x: 10, y: 0 }];
      const prev = pts.map((q) => ({ ...q }));
      const before = angleAt(pts, 2);
      const s1 = seg(pts, 1), s2 = seg(pts, 2);
      expect(before).toBeLessThan(10);
      openTightFolds(pts, prev, [0, 0, 1, 0, 0], new Array(5).fill(0), 5, MIN, 1);
      expect(angleAt(pts, 2)).toBeGreaterThan(before + 20);
      // It opens by rotating about the centre, so no segment is stretched and
      // the length solver has nothing to undo.
      expect(seg(pts, 1)).toBeCloseTo(s1, 6);
      expect(seg(pts, 2)).toBeCloseTo(s2, 6);
    });

    it("leaves an ordinary drape alone", () => {
      const pts: P[] = [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 26 }, { x: 150, y: 20 }, { x: 200, y: 0 }];
      const prev = pts.map((q) => ({ ...q }));
      const copy = pts.map((q) => ({ ...q }));
      openTightFolds(pts, prev, [0, 0, 0, 0, 0], new Array(5).fill(0), 5, MIN, 1);
      pts.forEach((q, i) => {
        expect(q.x).toBeCloseTo(copy[i].x, 9);
        expect(q.y).toBeCloseTo(copy[i].y, 9);
      });
    });

    it("never moves a plug, and curls the same way each time when shut flat", () => {
      // A fold closed flat has no geometry left to say which way it should go —
      // that is the same rounding error that made the vertical cords jitter — so
      // the direction comes from the remembered kink and is stable per point.
      const shut = (kinkSign: number) => {
        const pts: P[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }, { x: 0, y: 100 }];
        openTightFolds(pts, pts.map((q) => ({ ...q })), [0, kinkSign, -kinkSign, 0], new Array(4).fill(0), 4, MIN, 1);
        return pts;
      };
      const pos = shut(1), neg = shut(-1);
      expect(pos[0]).toEqual({ x: 0, y: 0 });          // pinned end untouched
      expect(pos[3]).toEqual({ x: 0, y: 100 });        // and the other one
      expect(Math.sign(pos[1].x)).toBe(-Math.sign(neg[1].x));
      expect(pos[1].x).not.toBe(0);
    });
  });
});
