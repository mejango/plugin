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
  for (let i = 1; i < n - 1; i++) {
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
      const pFree = i > 0, qFree = i + 1 < n - 1;
      const diff = (dl - r.rest) / dl / (pFree && qFree ? 2 : 1);
      const ox = dx * diff, oy = dy * diff, oz = dz * diff;
      if (pFree) { p.x += ox; p.y += oy; p.z += oz; }
      if (qFree) { q.x -= ox; q.y -= oy; q.z -= oz; }
    }
  }
}

/** Is segment i of this rope in the air near a held plug? The stretch out of a
 * hand is lifted, so it passes over what it is carried across. */
/**
 * Bending stiffness. A cord is not a chain: it resists being bent, and left
 * alone it wants to straighten. Each interior point is drawn toward the midpoint
 * of its neighbours — the discrete curvature — by `k`, and `prev` moves with it
 * so the stiffness shapes the cord without inventing any speed. Pinned ends do
 * not move. Run it BEFORE the length solve, which puts the spacing back.
 */
export function bend3(r: Rope3, k: number) {
  const n = r.pts.length;
  const dx = new Float64Array(n), dy = new Float64Array(n), dz = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const p = r.pts[i], a = r.pts[i - 1], b = r.pts[i + 1];
    let cx = ((a.x + b.x) / 2 - p.x) * k, cy = ((a.y + b.y) / 2 - p.y) * k, cz = ((a.z + b.z) / 2 - p.z) * k;
    // Only the part ACROSS the cord: bending moves a point sideways, it does not
    // reel cord in. Straight toward the midpoint shortens the curve every pass,
    // which the length solve then has to undo — and under a fast drag it cannot
    // keep up, so the cord visibly loses length.
    const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const tl = tx * tx + ty * ty + tz * tz;
    if (tl > 1e-12) {
      const d = (cx * tx + cy * ty + cz * tz) / tl;
      cx -= tx * d; cy -= ty * d; cz -= tz * d;
    }
    dx[i] = cx; dy[i] = cy; dz[i] = cz;
  }
  for (let i = 1; i < n - 1; i++) {
    const p = r.pts[i], q = r.prev[i];
    p.x += dx[i]; p.y += dy[i]; p.z += dz[i];
    q.x += dx[i]; q.y += dy[i]; q.z += dz[i];
    if (p.z < 0) p.z = 0;
  }
}

/**
 * Minimum bend radius. A cable cannot be folded flat: past some angle it stops
 * bending and bulges into a rounded bight instead. Where a point's two arms have
 * closed tighter than `minDeg`, rotate them apart about it. Pinned ends stay put,
 * and `prev` follows so no speed is invented. This is what stops a dragged cord
 * collapsing into a hairpin — a bending spring alone is always overpowered by
 * the hand, because the hand wins every argument.
 */
export function unkink3(r: Rope3, minDeg: number, relax: number) {
  const n = r.pts.length;
  const minCos = Math.cos((minDeg * Math.PI) / 180);
  for (let i = 1; i < n - 1; i++) {
    const p = r.pts[i], pm = r.pts[i - 1], pp = r.pts[i + 1];
    const ax = pm.x - p.x, ay = pm.y - p.y, la = Math.hypot(ax, ay) || 1e-6;
    const bx = pp.x - p.x, by = pp.y - p.y, lb = Math.hypot(bx, by) || 1e-6;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < minCos) continue;                       // open enough already
    const target = Math.acos(Math.max(-1, Math.min(1, minCos)));
    const cur = Math.acos(Math.max(-1, Math.min(1, cos)));
    const sgn = ax * by - ay * bx >= 0 ? 1 : -1;
    const mFree = i - 1 > 0, pFree = i + 1 < n - 1;
    const each = ((target - cur) * relax) / (mFree && pFree ? 2 : 1);
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
 */
export function collide3(ropes: Rope3[], iters: number): boolean[] {
  const moved = ropes.map(() => false);
  for (let it = 0; it < iters; it++) {
    for (let a = 0; a < ropes.length; a++) {
      for (let b = a; b < ropes.length; b++) {
        const A = ropes[a], B = ropes[b];
        const self = a === b;
        const reach = A.r + B.r;
        const na = A.pts.length, nb = B.pts.length;
        for (let i = 0; i < na - 1; i++) {
          for (let j = self ? i + 2 : 0; j < nb - 1; j++) {
            if (self && i === 0 && j === nb - 2) continue;   // a cord's two ends never meet
            const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
            if (c.d >= reach || c.d < 1e-6) continue;
            let nx = c.dx / c.d, ny = c.dy / c.d, nz = c.dz / c.d;
            // two stretches lying flat and crossing separate along almost pure
            // z with rounding for a sign: nudge them onto z so one rides over
            // the other instead of jostling in the plane
            if (Math.abs(nz) < 0.2) {
              const s = nz >= 0 ? 1 : -1;
              nz = 0.4 * s; const f = Math.hypot(nx, ny) || 1e-6;
              const k = Math.sqrt(1 - nz * nz) / f; nx *= k; ny *= k;
            }
            const push = (reach - c.d) / 2;
            const shove = (R: Rope3, k: number, t: number, sign: number) => {
              if (lifted(R, k)) return;
              const n = R.pts.length;
              const g0 = k > 0 ? 1 - t : 0, g1 = k + 1 < n - 1 ? t : 0;
              const spread = g0 * g0 + g1 * g1;
              if (spread < 1e-6) return;
              const m = (push * sign) / spread;
              const p0 = R.pts[k], p1 = R.pts[k + 1], r0 = R.prev[k], r1 = R.prev[k + 1];
              if (g0) { p0.x += nx * m * g0; p0.y += ny * m * g0; p0.z += nz * m * g0; if (p0.z < 0) p0.z = 0; r0.x += nx * m * g0; r0.y += ny * m * g0; r0.z += nz * m * g0; }
              if (g1) { p1.x += nx * m * g1; p1.y += ny * m * g1; p1.z += nz * m * g1; if (p1.z < 0) p1.z = 0; r1.x += nx * m * g1; r1.y += ny * m * g1; r1.z += nz * m * g1; }
            };
            shove(A, i, c.t, 1); shove(B, j, c.s, -1);
            moved[a] = true; moved[b] = true;
          }
        }
      }
    }
  }
  return moved;
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

export type Post = { x0: number; y0: number; x1: number; y1: number; r: number };

/**
 * A seated plug is a post standing off the board: a capsule x0,y0 -> x1,y1 of
 * radius r. Every point of the rope below maxZ, other than indices in
 * [skipFrom, skipTo], is pushed out of it to the nearest side. Returns how
 * many points moved.
 */
export function offPost3(rope: Rope3, post: Post, maxZ: number, skipFrom = -1, skipTo = -1): number {
  const R = post.r + rope.r, dx = post.x1 - post.x0, dy = post.y1 - post.y0, ll = dx * dx + dy * dy || 1;
  let moved = 0;
  for (let i = 0; i < rope.pts.length; i++) {
    if (i >= skipFrom && i <= skipTo) continue;
    const p = rope.pts[i];
    if (p.z > maxZ) continue;
    const t = clamp01(((p.x - post.x0) * dx + (p.y - post.y0) * dy) / ll);
    const cx = post.x0 + dx * t, cy = post.y0 + dy * t;
    let nx = p.x - cx, ny = p.y - cy, d = Math.hypot(nx, ny);
    if (d >= R) continue;
    // ponytail: nearest-side pushout; the engine's 8px substep keeps it honest.
    // Swept test against prev if a flick ever tunnels a post.
    if (d < 1e-6) { nx = -dy; ny = dx; d = Math.sqrt(ll); }
    p.x = cx + (nx / d) * R; p.y = cy + (ny / d) * R;
    moved++;
  }
  return moved;
}
