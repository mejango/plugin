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
  freeA?: boolean;           // end a is loose: unplugged, lying on the board, nothing holds it
  freeB?: boolean;
  onPost?: Uint8Array;       // per point: resting on top of a seated plug (set here, cleared by the caller when it leaves)
  frozen?: boolean;          // asleep: a static obstacle in contact, never a mover
  pinned?: Uint8Array;       // per point: held still by the board (shelf friction); no pass moves it
  frameStart?: Float64Array; // x,y pairs: where every point was when this frame began (a fixed reference; `prev` drifts with the passes)
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
    if (r.pinned?.[i]) continue;
    const p = r.pts[i], q = r.prev[i];
    const vx = (p.x - q.x) * damp;
    const vy = (p.y - q.y) * damp + gy;
    // z is a spring toward the board, not a free fall: a cord settles flat and
    // rests ON another at one diameter up, it does not pile up or sink through.
    // z is overdamped: height is a thing a cord is pushed to, not a thing it
    // moves through — any z velocity the constraint passes invent (the bend
    // pass moves prev, the length solve does not) must die within a frame,
    // or a point over-constrained in the plane pogoes to 200px high
    const vz = (p.z - q.z) * 0.3 - p.z * gz;
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
      const pFree = (i > 0 || !!r.freeA) && !r.pinned?.[i], qFree = (i + 1 < n - 1 || !!r.freeB) && !r.pinned?.[i + 1];
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
    if (r.pinned?.[i]) continue;
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
    // not about a pinned point: it swung the free neighbour of a shelf pin
    // out every substep and the length solve pulled it back — a free span
    // between two pins vibrated for ever
    if (r.pinned?.[i]) continue;
    const p = r.pts[i], pm = r.pts[i - 1], pp = r.pts[i + 1];
    const ax = pm.x - p.x, ay = pm.y - p.y, la = Math.hypot(ax, ay) || 1e-6;
    const bx = pp.x - p.x, by = pp.y - p.y, lb = Math.hypot(bx, by) || 1e-6;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < minCos) continue;                       // open enough already
    const target = Math.acos(Math.max(-1, Math.min(1, minCos)));
    const cur = Math.acos(Math.max(-1, Math.min(1, cos)));
    const sgn = ax * by - ay * bx >= 0 ? 1 : -1;
    const mFree = i - 1 > 0 && !r.pinned?.[i - 1], pFree = i + 1 < n - 1 && !r.pinned?.[i + 1];
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
function crossXY(p0: P3, p1: P3, q0: P3, q1: P3): boolean {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, vx = q1.x - q0.x, vy = q1.y - q0.y;
  const den = ux * vy - uy * vx;
  if (Math.abs(den) < 1e-12) return false;
  const wx = q0.x - p0.x, wy = q0.y - p0.y;
  const t = (wx * vy - wy * vx) / den, u = (wx * uy - wy * ux) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Which of a crossing pair is on top, remembered for as long as they cross:
 * one cord cannot pass through the other, so the order can only change once
 * they have come apart and crossed again. Keyed "a:b" by rope index, +1 for a
 * over b. ponytail: one order per PAIR, so a cord weaving over then under the
 * same cord shares it; key by crossing if weaving matters. */
export type CrossOrder = Map<string, 1 | -1>;

export function collide3(ropes: Rope3[], iters: number, order?: CrossOrder): boolean[] {
  const moved = ropes.map(() => false);
  const seen = new Set<string>();
  for (let it = 0; it < iters; it++) {
    for (let a = 0; a < ropes.length; a++) {
      for (let b = a; b < ropes.length; b++) {
        const A = ropes[a], B = ropes[b];
        const self = a === b;
        if (self && A.frozen) continue;   // a sleeping cord's own fold pushed it awake every frame
        // two sleepers keep their order: skipped without being "seen", the
        // pair's over/under was pruned the frame both slept, and the draw
        // order flipped the top cord underneath while nothing had moved
        if (A.frozen && B.frozen) { const key = a + ":" + b; if (order?.has(key)) seen.add(key); continue; }
        const reach = A.r + B.r;
        const na = A.pts.length, nb = B.pts.length;
        for (let i = 0; i < na - 1; i++) {
          for (let j = self ? i + 2 : 0; j < nb - 1; j++) {
            if (self && i === 0 && j === nb - 2) continue;   // a cord's two ends never meet
            const c = segClosest3(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
            let nx = c.dx / c.d, ny = c.dy / c.d, nz = c.dz / c.d;
            let gap = reach - c.d;
            const key = a + ":" + b, known = self ? undefined : order?.get(key);
            const crossing = !self && crossXY(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
            if (!crossing && c.d >= reach) continue;
            // Stretches that CROSS in the plane cannot be pushed apart in the
            // plane: one lies over the other, so the contact is pure z, and
            // whoever is over stays over. Dead level (two cords laid flat
            // across each other) the earlier-dealt cord rides over. And once
            // a pair is ordered, EVERY contact between them is pure z: a cord
            // riding over another is never caught on it, it slides across.
            if (crossing || known) {
              let sign = known;
              if (!sign) { sign = c.dz < -1e-6 ? -1 : 1; order?.set(key, sign); }
              // the order lives while the pair TOUCH anywhere, not only while
              // they cross: a crossing point sliding past a joint uncrosses
              // for a substep, and re-deciding from heights then put the under
              // cord on top
              seen.add(key);
              const sep = sign * c.dz;          // how far the right one is above the other
              if (sep >= reach) continue;
              nx = 0; ny = 0; nz = sign; gap = reach - sep;
            } else if (c.d < 1e-6) continue;
            else if (Math.abs(nz) < 0.2) {
              // a near miss lying flat: nudge onto z so one rides over the
              // other instead of jostling in the plane
              const s = nz >= 0 ? 1 : -1;
              nz = 0.4 * s; const f = Math.hypot(nx, ny) || 1e-6;
              const k = Math.sqrt(1 - nz * nz) / f; nx *= k; ny *= k;
            }
            // Crossing: the lower cord gives way DOWN first, as far as the
            // board allows; only the rest lifts the upper one. An under cord
            // whose end is picked up cannot rise through what lies over it.
            let fA = 0.5;
            if (Math.abs(nz) >= 0.4) {
              const zA = A.pts[i].z + (A.pts[i + 1].z - A.pts[i].z) * c.t;
              const zB = B.pts[j].z + (B.pts[j + 1].z - B.pts[j].z) * c.s;
              const lowerRoom = Math.min(1, (nz > 0 ? zB : zA) / (gap * Math.abs(nz)));   // fraction the lower can take
              fA = nz > 0 ? 1 - lowerRoom : lowerRoom;
            }
            const shove = (R: Rope3, k: number, t: number, sign: number, push: number) => {
              if (lifted(R, k) || R.frozen) return;
              const n = R.pts.length;
              const g0 = k > 0 && !R.pinned?.[k] ? 1 - t : 0, g1 = k + 1 < n - 1 && !R.pinned?.[k + 1] ? t : 0;
              const spread = g0 * g0 + g1 * g1;
              if (spread < 1e-6) return;
              // No endpoint moves further than the gap itself. Weighted by
              // lever arm, a segment with its other end pinned (a shelf pin,
              // a plug) got push / (1 - t)² — a hundred times the gap near
              // the pin — and a piled cord took 12px kicks at rest.
              const m = (push * sign) / spread * Math.min(1, spread / Math.max(g0, g1));
              const p0 = R.pts[k], p1 = R.pts[k + 1], r0 = R.prev[k], r1 = R.prev[k + 1];
              // The board is solid: a push through it stops at z = 0 — and
              // `prev` stops with it. Clamping only `pts` left `prev` far
              // below the board, which the integrator read as a huge upward
              // velocity: the cord pogoed to 70px high, over every post.
              const move = (p: P3, r: P3, g: number) => {
                p.x += nx * m * g; p.y += ny * m * g; p.z += nz * m * g;
                r.x += nx * m * g; r.y += ny * m * g; r.z += nz * m * g;
                if (p.z < 0) { r.z -= p.z; p.z = 0; }
              };
              if (g0) move(p0, r0, g0);
              if (g1) move(p1, r1, g1);
            };
            shove(A, i, c.t, 1, gap * fA); shove(B, j, c.s, -1, gap * (1 - fA));
            moved[a] = true; moved[b] = true;
          }
        }
      }
    }
  }
  if (order) for (const k of order.keys()) if (!seen.has(k)) order.delete(k);
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
 * radius r. Every SEGMENT of the rope below maxZ, other than those wholly
 * inside [skipFrom, skipTo], is pushed out of it — to the side it CAME from
 * (its `prev`), not the nearer side: a taut cord's length solve drags it
 * straight back through the post every substep, and the nearer side flips
 * once it is past the axis. Segments, not points, because a cord's points
 * straddle a rounded post end and the stretch between them cuts the corner.
 * Returns how many segments moved.
 */
/** `mode`: 0 = geometry decides (side or top, whichever is nearer); 1 = the
 * rope is OVER the post's owner and rides over the post; -1 = the rope is
 * UNDER the post's owner and is blocked, with no height escape. */
export function offPost3(rope: Rope3, post: Post, maxZ: number, skipFrom = -1, skipTo = -1, mode = 0): number {
  const R = post.r + rope.r, n = rope.pts.length;
  const a0 = { x: post.x0, y: post.y0, z: 0 }, a1 = { x: post.x1, y: post.y1, z: 0 };
  const al = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
  const pnx = -(a1.y - a0.y) / al, pny = (a1.x - a0.x) / al;   // across the post
  let moved = 0;
  // Swept: a point that was on one side of the barrel when the frame began
  // and is on the other now went THROUGH it, however far it got. The
  // contact test below only sees what is within R of the axis: a taut cord
  // fed through the bar one point at a time, each pulled across by the
  // length solve, pushed back while within R, and free the substep it
  // jumped further than that.
  const fs = rope.frameStart;
  if (fs && mode <= 0) for (let i = 0; i < n; i++) {
    if (i >= skipFrom && i <= skipTo) continue;
    if (i === 0 ? !rope.freeA : i === n - 1 ? !rope.freeB : false) continue;
    if (rope.pinned?.[i]) continue;
    const p = rope.pts[i];
    if (mode === 0 && (p.z > maxZ || rope.onPost?.[i])) continue;
    const sx = a1.x - a0.x, sy = a1.y - a0.y, ll = sx * sx + sy * sy || 1;
    const s0 = ((fs[2 * i] - a0.x) * sx + (fs[2 * i + 1] - a0.y) * sy) / ll, s1 = ((p.x - a0.x) * sx + (p.y - a0.y) * sy) / ll;
    if (s0 <= 0 || s0 >= 1 || s1 <= 0 || s1 >= 1) continue;
    const w0 = (fs[2 * i] - a0.x) * pnx + (fs[2 * i + 1] - a0.y) * pny, w1 = (p.x - a0.x) * pnx + (p.y - a0.y) * pny;
    if (Math.abs(w0) < 1e-6 || Math.sign(w0) === Math.sign(w1)) continue;
    const back = Math.sign(w0) * R - w1;
    p.x += pnx * back; p.y += pny * back;
    moved++;
  }
  for (let i = 0; i < n - 1; i++) {
    if (i >= skipFrom && i + 1 <= skipTo) continue;
    const p = rope.pts[i], q = rope.pts[i + 1];
    // a cord under the post's owner has no height escape: however high the
    // hand holds it, it does not get above that cord's plug
    if (mode >= 0 && Math.min(p.z, q.z) > maxZ) continue;
    const c = segClosest3({ x: p.x, y: p.y, z: 0 }, { x: q.x, y: q.y, z: 0 }, a0, a1);   // dx,dy: post point -> rope point
    if (c.d >= R) continue;
    // "Where it came from" is the frame start, not `prev`: bend and unkink
    // move `prev` with the point, and at a sharp hook that reference crossed
    // the post line with it, so the push-out threw the cord to the far side.
    const pp = fs ? { x: fs[2 * i], y: fs[2 * i + 1], z: 0 } : rope.prev[i], pq = fs ? { x: fs[2 * i + 2], y: fs[2 * i + 3], z: 0 } : rope.prev[i + 1];
    // The post is a solid with a top. A stretch lying across it — a plug
    // seated under a resting cord, or a deal that laid one there — is nearer
    // the top than a side: it rides up onto the plug's back and rests there,
    // as a cord does on another cord. A stretch at board height pressed into
    // a side is blocked by that side.
    // Once up it stays up while it overlaps the post (the caller clears
    // `onPost` when it leaves): decided afresh each frame, the z-spring
    // halving its height made it flicker between lifted and shoved aside.
    const zmid = p.z + (q.z - p.z) * c.t, on = rope.onPost;
    if (mode > 0 || (mode === 0 && ((on && (on[i] || on[i + 1])) || maxZ - zmid < R - c.d))) {
      const up = (v: P3, w: P3, k: number) => { if (v.z < maxZ + 0.5) { v.z = maxZ + 0.5; w.z = v.z; } if (on) on[k] = 1; };   // prev follows: no invented speed
      if (i > 0 || rope.freeA) up(p, pp, i);
      if (i + 1 < n - 1 || rope.freeB) up(q, pq, i + 1);
      continue;
    }
    const cx = p.x + (q.x - p.x) * c.t - c.dx, cy = p.y + (q.y - p.y) * c.t - c.dy;    // the post point
    const wasX = pp.x + (pq.x - pp.x) * c.t - cx, wasY = pp.y + (pq.y - pp.y) * c.t - cy;
    const side = Math.sign(wasX * pnx + wasY * pny) || Math.sign(c.dx * pnx + c.dy * pny) || 1;
    let mx, my;
    const onBarrel = c.s > 1e-6 && c.s < 1 - 1e-6;   // the round ends have no sides
    if (c.d > 1e-6 && (!onBarrel || Math.sign(c.dx * pnx + c.dy * pny) === side)) {
      mx = (c.dx / c.d) * (R - c.d); my = (c.dy / c.d) * (R - c.d);      // still on its side: straight out
    } else {
      // it has crossed the axis: back through to its own side
      const along = c.dx * pnx + c.dy * pny;
      mx = pnx * (side * R - along); my = pny * (side * R - along);
    }
    const g0 = (i > 0 || rope.freeA) && !rope.pinned?.[i] ? 1 - c.t : 0, g1 = (i + 1 < n - 1 || rope.freeB) && !rope.pinned?.[i + 1] ? c.t : 0;
    let spread = g0 * g0 + g1 * g1;
    if (spread < 1e-6) continue;
    spread = Math.max(spread, Math.max(g0, g1));   // no endpoint moves further than the gap (see collide3)
    // Friction. Frictionless, a hooked cord slides round any round post to
    // its straight line. A cord that BENDS round the post (capstan: the wrap
    // angle is what holds) does not slide at all; one merely pressed against
    // it holds by how hard it presses — how far the solve sank it this pass.
    const ml = Math.hypot(mx, my) || 1, tx = -my / ml, ty = mx / ml;
    const bendAt = (a: P3, b: P3, d: P3) => {   // cos of the turn at b, from a to d
      const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y;
      return (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1));
    };
    const turn = Math.min(i > 0 ? bendAt(rope.pts[i - 1], p, q) : 1, i + 2 < n ? bendAt(p, q, rope.pts[i + 2]) : 1);
    // > ~18° round it: hooked. A wrap spreads over two or three segments, so
    // no single point turns much; at 30° a 45° wrap slid off by luck of timing.
    // No friction against a rope's OWN plug (skipFrom >= 0): a cord doubling
    // back beside its barrel held its tangent to a `prev` the bend pass kept
    // moving, and the two settled into a steady 5px shimmer.
    const stick = skipFrom >= 0 ? 0 : turn < 0.95 ? 1 : Math.min(1, (R - c.d) / (0.25 * R));
    const hold = (v: P3, w: P3, g: number) => {
      v.x += mx * g / spread; v.y += my * g / spread;
      const slid = (v.x - w.x) * tx + (v.y - w.y) * ty;
      v.x -= tx * slid * stick; v.y -= ty * slid * stick;
    };
    if (g0) hold(p, pp, g0);
    if (g1) hold(q, pq, g1);
    moved++;
  }
  return moved;
}
