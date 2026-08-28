// A patch bay in 2.5D. The board is a plane at z = 0; cords are ropes lying on
// it, thin things with a real height. "Over" and "under" are not decisions any
// more — they are just which cord ended up higher in z where they cross. A
// cord dropped across another rests on top of it; one held down stays low; a
// cord wound round another wraps because a real rope in three dimensions wraps.
//
// There is exactly ONE contact rule — two cords, or a cord and itself, cannot
// occupy the same space — solved in a space where the answer is unambiguous.
// No crossing objects, no over/under flags, no rings, no annihilation rules:
// the whole topological bookkeeping of the flat model is gone, and with it the
// class of bugs that lived in it.
//
// Pure: no canvas, no jacks. The renderer and the driver hand it a view of the
// cords and read the positions back; the tests drive it the same way.

export type P3 = { x: number; y: number; z: number };
export type Rope3 = {
  pts: P3[];
  prev: P3[];
  r: number;                 // cord radius (half its drawn width)
  rest: number;              // segment rest length
  heldA: boolean;            // end a (pts[0]) is in a hand / flying — lifted, in the air
  heldB: boolean;            // end b likewise
  freeA?: boolean;           // end a is unplugged: a free point, not a pin
  freeB?: boolean;           // end b likewise
};

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Closest approach between segment p0->p1 and q0->q1 in 3D: the fractions along
 * each and the separation vector from the q-point to the p-point. This is the
 * one geometric primitive the contact rule needs.
 */
export function segClosest3(p0: P3, p1: P3, q0: P3, q1: P3) {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
  const vx = q1.x - q0.x, vy = q1.y - q0.y, vz = q1.z - q0.z;
  const wx = p0.x - q0.x, wy = p0.y - q0.y, wz = p0.z - q0.z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const den = a * c - b * b;
  let t = den > 1e-9 ? (b * e - c * d) / den : 0;
  t = clamp01(t);
  let s = c > 1e-9 ? (b * t + e) / c : 0;
  s = clamp01(s);
  t = a > 1e-9 ? (b * s - d) / a : 0;
  t = clamp01(t);
  const px = p0.x + ux * t, py = p0.y + uy * t, pz = p0.z + uz * t;
  const qx = q0.x + vx * s, qy = q0.y + vy * s, qz = q0.z + vz * s;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return { t, s, dx, dy, dz, d: Math.hypot(dx, dy, dz) };
}

/** One Verlet step. Gravity `gy` pulls cords down the screen; `gz` pulls them
 * onto the board (toward z = 0). Pinned/held ends are integrated by the caller. */
export function integrate3(r: Rope3, gy: number, gz: number, damp: number) {
  const n = r.pts.length;
  for (let i = r.freeA ? 0 : 1; i < (r.freeB ? n : n - 1); i++) {
    const p = r.pts[i], q = r.prev[i];
    const vx = (p.x - q.x) * damp;
    const vy = (p.y - q.y) * damp + gy;
    // z is a spring toward the board, not a free fall: a cord settles flat and
    // rests ON another at one diameter up, it does not pile up or sink through.
    const vz = (p.z - q.z) * damp - p.z * gz;
    q.x = p.x; q.y = p.y; q.z = p.z;
    p.x += vx; p.y += vy; p.z += vz;
    if (p.z < 0) p.z = 0;                 // the board is solid
  }
}

/** Inextensible: bring each segment back to its rest length. Free points share
 * the correction; a pinned end (index 0 / n-1) absorbs none. Moves in 3D. */
export function constrainLength3(r: Rope3, iters: number) {
  const n = r.pts.length;
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < n - 1; k++) {
      const i = it % 2 === 0 ? k : n - 2 - k;
      const p = r.pts[i], q = r.pts[i + 1];
      const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
      const dl = Math.hypot(dx, dy, dz) || 1e-6;
      const pFree = i > 0 || !!r.freeA, qFree = i + 1 < n - 1 || !!r.freeB;
      const diff = (dl - r.rest) / dl / (pFree && qFree ? 2 : 1);
      const ox = dx * diff, oy = dy * diff, oz = dz * diff;
      if (pFree) { p.x += ox; p.y += oy; p.z += oz; }
      if (qFree) { q.x -= ox; q.y -= oy; q.z -= oz; }
    }
  }
}

/** Is segment i of this rope in the air near a held plug? The stretch out of a
 * hand is lifted, so it passes over what it is carried across. */
export function lifted(r: Rope3, i: number) {
  if (r.heldA && r.heldB) return true;
  if (r.heldA && i <= 0) return true;
  if (r.heldB && i >= r.pts.length - 2) return true;
  return false;
}

/**
 * The one contact rule: no two stretches of cord may occupy the same space.
 * For every pair of non-adjacent segments — between two cords, or within one
 * cord — that come within their combined radius, push them apart along the
 * line of closest approach, moving `prev` with `pts` so no speed is invented.
 *
 * When two cords cross flat on the board the separation is almost pure z, so
 * one rides up onto the other: that IS over/under, decided by geometry, not a
 * flag. A carried (lifted) stretch is skipped as the mover — it is above the
 * board and passes over — but it still shoves what is beneath it.
 *
 * `stick` remembers which cord is on top for each pair, and is the one bit of
 * physical state the rule keeps: two cords cannot swap who is over whom without
 * first pulling clear of each other. While a pair stays in contact the order is
 * held; only when they separate (closest approach past the contact band) is the
 * memory dropped, so the next time they touch the stack is decided fresh. Pass
 * a persistent Map to get this (the driver does); omit it and each call decides
 * from geometry alone (fine for one-shot settling, and what the unit tests use).
 */
export function collide3(ropes: Rope3[], iters: number, stick: Map<string, number> = new Map()): boolean[] {
  const moved = ropes.map(() => false);
  for (let it = 0; it < iters; it++) {
    for (let a = 0; a < ropes.length; a++) {
      for (let b = a; b < ropes.length; b++) {
        const A = ropes[a], B = ropes[b];
        const self = a === b;
        const reach = A.r + B.r;
        const na = A.pts.length, nb = B.pts.length;
        const hits: { i: number; j: number; t: number; s: number; dx: number; dy: number; dz: number; d: number }[] = [];
        let minD = Infinity;
        for (let i = 0; i < na - 1; i++) {
          for (let j = self ? i + 2 : 0; j < nb - 1; j++) {
            if (self && i === 0 && j === nb - 2) continue;
            const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
            // the memory releases on IN-PLANE separation: a hand lifted straight
            // above the other cord is still over/under it, not clear of it
            const dxy = Math.hypot(c.dx, c.dy);
            if (dxy < minD) minD = dxy;
            if (c.d >= reach || c.d < 1e-6) continue;
            hits.push({ i, j, t: c.t, s: c.s, dx: c.dx, dy: c.dy, dz: c.dz, d: c.d });
          }
        }
        // Once the cords are clearly apart (past the contact band) forget who
        // was on top — a fresh touch is free to stack either way. The band
        // spans the 1px grazing dips of a resting crossing so a settled stack
        // is never counted as "separated".
        const key = self ? "" : a + "," + b;
        if (key && minD >= reach * 1.6) stick.delete(key);
        if (!hits.length) continue;
        // Phase 1: ONE stacking order for this pair of cords. If we already know
        // who is on top from an unbroken contact, KEEP it — a cord lifted near
        // its hand cannot climb over another it is still caught under; it must
        // be pulled clear first. Only a first, memory-less contact reads the
        // order from the net z difference across the overlap (edge pairs at the
        // same level cannot out-vote the crossing, so it does not flicker).
        let order = key ? stick.get(key) ?? 0 : 0;
        if (!order) {
          let netdz = 0;
          for (const hh of hits) netdz += (reach - hh.d) * hh.dz;
          order = netdz > 1e-6 ? 1 : netdz < -1e-6 ? -1 : (a < b ? -1 : 1);
          if (key) stick.set(key, order);
        }
        // Phase 2: separate every colliding pair, mostly in z along that one
        // order, a little in the plane so a stack is not perfectly colinear.
        for (const hh of hits) {
          // Separate along geometry in the plane — that is what stops a fast
          // drag passing through — but the z-component's SIGN is the pair's one
          // order (no flicker) and floored so a flat crossing lifts one cord
          // over the other rather than shoving them apart sideways.
          // Separate PURELY in z: at a crossing the two cords are meant to
          // overlap in the plane — one simply rides over the other — so the
          // push has no in-plane part to jostle the crossing sideways. A
          // sideways part made two crossing cords wiggle forever at rest.
          const nx = 0, ny = 0, nz = order;
          const push = (reach - hh.d) / 2;
          const shove = (R: Rope3, k: number, t: number, sgn: number) => {
            if (lifted(R, k)) return;
            const n = R.pts.length;
            const g0 = k > 0 ? 1 - t : 0, g1 = k + 1 < n - 1 ? t : 0;
            const spread = g0 * g0 + g1 * g1;
            if (spread < 1e-6) return;
            const m = (push * sgn) / spread;
            const p0 = R.pts[k], p1 = R.pts[k + 1], r0 = R.prev[k], r1 = R.prev[k + 1];
            if (g0) { p0.x += nx * m * g0; p0.y += ny * m * g0; p0.z += nz * m * g0; if (p0.z < 0) p0.z = 0; r0.x += nx * m * g0; r0.y += ny * m * g0; }
            if (g1) { p1.x += nx * m * g1; p1.y += ny * m * g1; p1.z += nz * m * g1; if (p1.z < 0) p1.z = 0; r1.x += nx * m * g1; r1.y += ny * m * g1; }
          };
          shove(A, hh.i, hh.t, 1); shove(B, hh.j, hh.s, -1);
          moved[a] = true; moved[b] = true;
        }
      }
    }
  }
  return moved;
}

/**
 * Minimum bend radius: a real cable resists folding flat. Where a point's two
 * arms have closed to nearly a hairpin, rotate them apart a little so the fold
 * opens into a rounded bight instead of a pinched crease that reads as the cord
 * "caught on itself". Works in the plane (z is tiny) and never moves a pinned
 * end. This is what a stiff rubber cord does; the solver has no other opinion
 * about how sharp a bend may be.
 */
export function openFolds3(r: Rope3, minCos: number, relax: number) {
  const n = r.pts.length;
  for (let i = 1; i < n - 1; i++) {
    const p = r.pts[i], pm = r.pts[i - 1], pp = r.pts[i + 1];
    const ax = pm.x - p.x, ay = pm.y - p.y, la = Math.hypot(ax, ay) || 1e-6;
    const bx = pp.x - p.x, by = pp.y - p.y, lb = Math.hypot(bx, by) || 1e-6;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < minCos) continue;                 // open enough, leave it
    // rotate each free arm outward about p to widen the angle
    const target = Math.acos(Math.max(-1, Math.min(1, minCos)));
    const cur = Math.acos(Math.max(-1, Math.min(1, cos)));
    const cross = ax * by - ay * bx;
    const sgn = cross >= 0 ? 1 : -1;
    const open = (target - cur) * relax;
    const mFree = i - 1 > 0, pFree = i + 1 < n - 1;
    const each = mFree && pFree ? open / 2 : open;
    const swing = (q: P3, prev: P3, ang: number) => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = q.x - p.x, dy = q.y - p.y;
      const nx = p.x + dx * ca - dy * sa, ny = p.y + dx * sa + dy * ca;
      prev.x += nx - q.x; prev.y += ny - q.y;
      q.x = nx; q.y = ny;
    };
    if (mFree) swing(pm, r.prev[i - 1], -sgn * each);
    if (pFree) swing(pp, r.prev[i + 1], sgn * each);
  }
}

/** Smallest 3D gap between any non-adjacent segment pair across two cords —
 * the measurement the tests use: if this stays at or above the cords' combined
 * radius, one cord never passed through the other. */
export function minPairGap(A: Rope3, B: Rope3): number {
  let m = Infinity;
  for (let i = 0; i < A.pts.length - 1; i++)
    for (let j = 0; j < B.pts.length - 1; j++) {
      const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
      if (c.d < m) m = c.d;
    }
  return m;
}
