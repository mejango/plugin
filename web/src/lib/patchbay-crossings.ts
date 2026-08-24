// Where one cord crosses another, kept from frame to frame.
//
// A crossing is a THING, not a measurement. It is born the moment two cords
// meet — whichever came to the other lands on top — and from then on it slides
// along both cords as they move, holding them together like a ring. Which cord
// is on top is decided once, at birth, and never again: a cord does not pass
// through another cord, so the only ways a crossing ends are the physical ones.
// A hand carries an end clear of it, or a bight slides out from under.
//
// Pure: no canvas, no jacks, no drag state. `startPatchBay` hands it a view of
// the cables and gets back the crossings; the tests drive it the same way.

export type Pt = { x: number; y: number };
export type Rope = {
  pts: Pt[];
  prev: Pt[];
  width: number;
  heldA: boolean;   // end `a` (pts[0]) is in a hand, or on its way to a jack
  heldB: boolean;   // end `b` (pts[n-1]) likewise
};
export type Crossing = {
  a: number; b: number;        // rope indices, a < b
  ia: number; ta: number;      // segment and fraction along rope a
  ib: number; tb: number;      // and along rope b
  over: number;                // which rope index is on top — set at birth, final
  linked: boolean;             // the cords actually cross here (a ring holds them);
                               // false is a touch — lying along each other
  lost?: boolean;              // not found this frame; kept, and the ring is closing it
};

type Hit = { a: number; b: number; ia: number; ib: number; t: number; u: number; linked: boolean; dist: number; claimed: boolean };

/** Closest approach of two segments, as fractions along each and the distance. */
function segNear(p0: Pt, p1: Pt, q0: Pt, q1: Pt): { t: number; u: number; d: number } {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y;
  const wx = p0.x - q0.x, wy = p0.y - q0.y;
  const uu = ux * ux + uy * uy, vv = vx * vx + vy * vy, uv = ux * vx + uy * vy;
  const uw = ux * wx + uy * wy, vw = vx * wx + vy * wy;
  const den = uu * vv - uv * uv;
  let t = den > 1e-9 ? (uv * vw - vv * uw) / den : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let u = vv > 1e-9 ? (uv * t + vw) / vv : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  t = uu > 1e-9 ? (uv * u - uw) / uu : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = p0.x + ux * t - (q0.x + vx * u), dy = p0.y + uy * t - (q0.y + vy * u);
  return { t, u, d: Math.hypot(dx, dy) };
}

/** Where segment p0→p1 crosses q0→q1, as fractions along each, or null. */
export function segHit(p0: Pt, p1: Pt, q0: Pt, q1: Pt): { t: number; u: number } | null {
  const ux = p1.x - p0.x, uy = p1.y - p0.y;
  const vx = q1.x - q0.x, vy = q1.y - q0.y;
  const den = ux * vy - uy * vx;
  if (Math.abs(den) < 1e-12) return null;
  const wx = q0.x - p0.x, wy = q0.y - p0.y;
  const t = (wx * vy - wy * vx) / den;
  const u = (wx * uy - wy * ux) / den;
  // half open, so a crossing sliding over a shared point belongs to exactly
  // one segment and never blinks out
  if (t < 0 || t >= 1 || u < 0 || u >= 1) return null;
  return { t, u };
}

/**
 * Is this stretch of cord in the air? The plug in a hand is held off the
 * panel, and the cord leaves it straight for a plug's length before it comes
 * down — that first segment passes over posts and cords alike. Pick the whole
 * cable up and all of it is off the panel.
 */
export function liftedSeg(r: Rope, i: number): boolean {
  if (r.heldA && r.heldB) return true;
  if (r.heldA && i === 0) return true;
  if (r.heldB && i === r.pts.length - 2) return true;
  return false;
}

const nearHeldEnd = (r: Rope, i: number) =>
  (r.heldA && r.heldB) || (r.heldA && i <= 1) || (r.heldB && i >= r.pts.length - 3);

function allHits(ropes: Rope[]): Hit[] {
  const hits: Hit[] = [];
  const box = ropes.map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of r.pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  });
  for (let a = 0; a < ropes.length; a++) {
    for (let b = a + 1; b < ropes.length; b++) {
      // Touching is lying within a cord's width of each other. Found out to a
      // little further than that, so a touch already known is not lost the
      // moment they ease apart by a hair; only a new one needs them close.
      const touch = (ropes[a].width + ropes[b].width) / 2;
      const A = box[a], B = box[b], pad = touch * 1.5;
      if (A.x1 + pad < B.x0 || B.x1 + pad < A.x0 || A.y1 + pad < B.y0 || B.y1 + pad < A.y0) continue;
      const P = ropes[a].pts, Q = ropes[b].pts;
      for (let i = 0; i < P.length - 1; i++) {
        for (let j = 0; j < Q.length - 1; j++) {
          const h = segHit(P[i], P[i + 1], Q[j], Q[j + 1]);
          if (h) { hits.push({ a, b, ia: i, ib: j, t: h.t, u: h.u, linked: true, dist: 0, claimed: false }); continue; }
          const n = segNear(P[i], P[i + 1], Q[j], Q[j + 1]);
          if (n.d < touch * 1.5) hits.push({ a, b, ia: i, ib: j, t: n.t, u: n.u, linked: false, dist: n.d / touch, claimed: false });
        }
      }
    }
  }
  // crossings first: the touches either side of one are part of it
  return hits.sort((p, q) => Number(q.linked) - Number(p.linked));
}

/**
 * One frame of the crossings' lives. `moved` is how far each rope travelled
 * this frame (decides who lands on top when nobody is holding either);
 * `held` is the rope in hand, or -1.
 *
 * Track first — every crossing looks for its intersection in a neighbourhood
 * of segments on both cords, never at a remembered point, because a
 * remembered point goes stale the moment either cord moves. Then decide what
 * a lost crossing means, then whatever intersection is left unclaimed is new.
 */
export function updateCrossings(ropes: Rope[], crossings: Crossing[], moved: number[], held: number): Crossing[] {
  const hits = allHits(ropes);
  const lost: Crossing[] = [];
  const kept: Crossing[] = [];
  // How far along either cord to look for a crossing that has moved: a hand
  // moves a plug sixty pixels a frame, and a short cord's segments are a
  // quarter of that.
  const segLen = (r: Rope) => {
    const p = r.pts[0], q = r.pts[r.pts.length - 1];
    return Math.max(1, Math.hypot(q.x - p.x, q.y - p.y) / (r.pts.length - 1));
  };
  const reachOf = (r: Rope) => Math.max(3, Math.ceil(90 / segLen(r)));
  for (const c of crossings) {
    // A plug pulled out from under a cord lifts clear of it: the stretch out
    // of the hand is in the air, and nothing on the panel is over it. A
    // crossing that had this cord under, on that stretch, is over now — it
    // ends here and is born again on top below, like any other cord the
    // lifted stretch is laid across.
    const under = c.over === c.a ? c.b : c.a;
    if (under === held && liftedSeg(ropes[held], held === c.a ? c.ia : c.ib)) continue;
    const ra = reachOf(ropes[c.a]), rb = reachOf(ropes[c.b]);
    // A crossing looks for where the cords cross; only failing that, for where
    // they touch. Taking the nearest of either let a crossing settle on a
    // touch beside the real intersection, which was then born again as a
    // second crossing of its own.
    let best: Hit | null = null, bd = Infinity;
    for (const wantLinked of c.linked ? [true, false] : [false, true]) {
      for (const h of hits) {
        if (h.claimed || h.a !== c.a || h.b !== c.b || h.linked !== wantLinked) continue;
        if (Math.abs(h.ia - c.ia) > ra || Math.abs(h.ib - c.ib) > rb) continue;
        const d = Math.abs(h.ia + h.t - (c.ia + c.ta)) + Math.abs(h.ib + h.u - (c.ib + c.tb));
        if (d < bd) { bd = d; best = h; }
      }
      if (best) break;
    }
    if (best) {
      best.claimed = true;
      c.ia = best.ia; c.ta = best.t; c.ib = best.ib; c.tb = best.u;
      // Once two cords cross they are crossed until something physical ends
      // it; easing apart by a hair is still a crossing, and the ring pulls it
      // closed. A touch that comes to cross, though, is a crossing from now on.
      if (best.linked) c.linked = true;
      c.lost = false;
      kept.push(c);
    } else if (c.linked) { c.lost = true; lost.push(c); }
    // a touch that is no longer touching has simply come apart — nothing held it
  }

  // Gone: off an end that a hand is holding. The plug is lifted clear.
  const dead = new Set<Crossing>();
  for (const c of lost) {
    if (nearHeldEnd(ropes[c.a], c.ia) || nearHeldEnd(ropes[c.b], c.ib)) dead.add(c);
  }
  // Gone: nothing is wound. Two cords that only ever cross the same way
  // round are one lying over the other, and a cord lying over another lifts
  // off it freely — however many times the two wiggle across each other in
  // the drawing. Only a WEAVE holds: a pair crossing both ways round has one
  // cord threaded through the other, and that is what the ring is for.
  const woven = (c: Crossing) =>
    crossings.some((o) => o.a === c.a && o.b === c.b && o.linked && o.over !== c.over);
  for (const c of lost) if (!dead.has(c) && !woven(c)) dead.add(c);
  // Gone: a bight slid out of a weave. Two crossings of the same pair, both
  // lost, the same cord on top at each, and nothing of that pair between them
  // on either cord — the stretch between is a loop over (or under) the other
  // cord, and with both ends of the loop gone it has come away.
  const along = (c: Crossing, r: number) => (c.a === r ? c.ia + c.ta : c.ib + c.tb);
  const between = (c1: Crossing, c2: Crossing, r: number) =>
    crossings.some((o) => o !== c1 && o !== c2 && o.a === c1.a && o.b === c1.b &&
      !dead.has(o) && (along(o, r) - along(c1, r)) * (along(o, r) - along(c2, r)) < 0);
  for (let i = 0; i < lost.length; i++) {
    const c1 = lost[i];
    if (dead.has(c1)) continue;
    for (let j = i + 1; j < lost.length; j++) {
      const c2 = lost[j];
      if (dead.has(c2) || c2.a !== c1.a || c2.b !== c1.b || c2.over !== c1.over) continue;
      if (between(c1, c2, c1.a) || between(c1, c2, c1.b)) continue;
      dead.add(c1); dead.add(c2);
      break;
    }
  }
  // Anything else lost was lost by a cord going through a cord. It stays, at
  // its last known place on both cords, and the ring pulls them back together.
  for (const c of lost) if (!dead.has(c)) kept.push(c);

  // Born: whichever cord came to the other is on top — unless this is more
  // of a contact already there. A cord lying along another does not change
  // which is on top partway down the run, and the stretch either side of a
  // crossing is the crossing, not a contact of its own.
  //
  // With no hand on either cord the answer comes from what is already
  // decided between them, if anything is: two cords lying close zig-zag
  // across each other as they settle, and deciding each of those crossings
  // by which cord happened to move more that frame dealt out a braid of
  // mixed sides that no bight could ever slide out of. A weave — over here,
  // under there — is made by hands, one drag at a time, not by settling.
  const adjacent = (h: Hit) => kept.find((o) => o.a === h.a && o.b === h.b &&
    Math.abs(o.ia - h.ia) <= 1 && Math.abs(o.ib - h.ib) <= 1);
  const nearest = (h: Hit) => {
    let best: Crossing | undefined, bd = Infinity;
    for (const o of kept) {
      if (o.a !== h.a || o.b !== h.b) continue;
      const d = Math.abs(o.ia - h.ia) + Math.abs(o.ib - h.ib);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  for (const h of hits) {
    if (h.claimed || h.dist >= 1) continue;
    const near = adjacent(h);
    if (near && !h.linked && near.linked) continue;
    const inHand = held === h.a || held === h.b;
    let over: number;
    if (near) over = near.over;
    else if (inHand) over = held;
    else {
      const o = nearest(h);
      over = o ? o.over : moved[h.a] >= moved[h.b] ? h.a : h.b;
    }
    kept.push({ a: h.a, b: h.b, ia: h.ia, ta: h.t, ib: h.ib, tb: h.u, over, linked: h.linked });
  }
  return kept;
}

/**
 * The ring. Each crossing holds its point on one cord against its point on the
 * other; where they have come apart, pull them back. Whoever can move takes
 * the correction — a pinned end takes none, the first segment out of a held
 * end takes none (the hand wins), and otherwise it is shared evenly between
 * the two cords. `prev` goes with `pts` so this changes where a cord is
 * without inventing any speed, which is what kept the last attempt twitching.
 *
 * Returns how far each rope was moved at most, so a sleeping one can be woken
 * — but only by a correction worth waking for. A crossing kept at its slop sits
 * a hair inside it and outside it by turns, and waking a cord for that kept the
 * whole panel from ever sleeping.
 */
export function solveCrossings(ropes: Rope[], crossings: Crossing[], passes: number): number[] {
  const moved = ropes.map(() => 0);
  for (let pass = 0; pass < passes; pass++) {
    for (const c of crossings) {
      if (!c.linked) continue;          // a touch holds nothing
      const A = ropes[c.a], B = ropes[c.b];
      const a0 = A.pts[c.ia], a1 = A.pts[c.ia + 1];
      const b0 = B.pts[c.ib], b1 = B.pts[c.ib + 1];
      const px = a0.x + (a1.x - a0.x) * c.ta, py = a0.y + (a1.y - a0.y) * c.ta;
      const qx = b0.x + (b1.x - b0.x) * c.tb, qy = b0.y + (b1.y - b0.y) * c.tb;
      const dx = qx - px, dy = qy - py;
      const d = Math.hypot(dx, dy);
      const slop = (A.width + B.width) / 4;
      if (d <= slop) continue;
      const need = d - slop;
      const nx = dx / d, ny = dy / d;
      const weights = (r: Rope, i: number, t: number) => {
        if (liftedSeg(r, i)) return [0, 0];
        const n = r.pts.length;
        return [i > 0 ? 1 - t : 0, i + 1 < n - 1 ? t : 0];
      };
      const [ga0, ga1] = weights(A, c.ia, c.ta), [gb0, gb1] = weights(B, c.ib, c.tb);
      const sa = ga0 * ga0 + ga1 * ga1, sb = gb0 * gb0 + gb1 * gb1;
      if (sa < 1e-9 && sb < 1e-9) continue;
      const shareA = sb < 1e-9 ? 1 : sa < 1e-9 ? 0 : 0.5;
      const push = (r: Rope, i: number, g: number, k: number) => {
        if (!g) return;
        const p = r.pts[i], q = r.prev[i];
        p.x += nx * k * g; p.y += ny * k * g;
        q.x += nx * k * g; q.y += ny * k * g;
      };
      if (shareA > 0) {
        const k = (need * shareA) / sa;
        push(A, c.ia, ga0, k); push(A, c.ia + 1, ga1, k);
        moved[c.a] = Math.max(moved[c.a], need * shareA);
      }
      if (shareA < 1) {
        const k = -(need * (1 - shareA)) / sb;
        push(B, c.ib, gb0, k); push(B, c.ib + 1, gb1, k);
        moved[c.b] = Math.max(moved[c.b], need * (1 - shareA));
      }
    }
  }
  return moved;
}
