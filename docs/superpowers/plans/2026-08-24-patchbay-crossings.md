# Patch bay crossings-as-rings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace per-cable z-order with persistent per-crossing over/under rings so cords never pass through each other, weave, pull each other, and unweave by dragging ends.

**Architecture:** New pure module `patchbay-crossings.ts` (track / birth / death / ring solve / lifted-zone helpers) driven from `step()`; `patchbay.ts` loses `restack`, `stack`, `touching`, `lastMoved`, and the rank-gated crossing hooks; `draw()` paints cords in deal order then knot-diagram patches.

**Tech Stack:** TypeScript, canvas 2D, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-patchbay-crossings-design.md`

## Global Constraints
- `over` of a crossing is written at birth and never changes.
- Rope feel (bend memory, fold limit, strain, length controller, sleep) untouched.
- Every correction moves `prev` with `pts` (no invented velocity).
- `npm run check` in `web/` stays green.

---

### Task 1: Crossing module — geometry, track, birth, death
**Files:** Create `web/src/lib/patchbay-crossings.ts`; Test `web/test/patchbay-crossings.test.ts`
**Produces:**
```ts
export type Pt = { x: number; y: number };
export type Rope = { pts: Pt[]; prev: Pt[]; width: number; heldA: boolean; heldB: boolean };
export type Crossing = { a: number; b: number; ia: number; ta: number; ib: number; tb: number; over: number /* rope index */ };
export function segHit(p0, p1, q0, q1): { t: number; u: number } | null
export function liftedSeg(r: Rope, i: number): boolean   // segment i is in the air (first segment out of a held end; every segment when both held)
export function updateCrossings(ropes: Rope[], crossings: Crossing[], moved: number[], held: number): Crossing[]
```
- [ ] Test: two straight ropes crossing → one crossing born, `over` = held rope (or the one with larger `moved`).
- [ ] Test: slide a rope 3 segments along the other over 10 frames → same object, `ia/ib` updated, never a second crossing.
- [ ] Test: lose the intersection with nobody near a held end → crossing kept (length unchanged).
- [ ] Test: lost within one segment of a held end → gone.
- [ ] Test: U under a straight rope, U pulled out → both gone (annihilation); mixed `over` pair → both kept.
- [ ] Implement; run `npx vitest run test/patchbay-crossings.test.ts`; commit.

### Task 2: Ring solve
**Files:** same. **Produces:** `export function solveCrossings(ropes, crossings, passes): boolean[]` (which ropes were moved).
- [ ] Test: separated rope points at a kept crossing are pulled to within `width/2`; both `pts` and `prev` move; pinned ends (index 0 / N-1) and the held first segment don't move.
- [ ] Test: rope A pinned both ends, rope B free in the middle → B takes the whole correction.
- [ ] Implement; tests pass; commit.

### Task 3: Wire into `step()`, delete the layering stack
**Files:** Modify `web/src/lib/patchbay.ts` (restack block ~L440–560, drag hooks block ~L1123–1150, `liftEnd`, `offStuds`).
- [ ] Delete `stack/restacking/allQuiet/touching/lastMoved/restack`; delete the rank-gated crossing-hook loop.
- [ ] `offStuds`: skip segments where `liftedSeg` is true; at SETTLE treat a lifted segment overlapping a stud as `inside` (cord carried onto the post rests on top).
- [ ] `liftEnd`: delete this end's stud key from every cable's `studsOn` (a replugged post is decided afresh).
- [ ] After the per-cable solve and stud passes: build `Rope[]` view of `cables`, compute `moved` from `c.was`, `crossings = updateCrossings(...)`, `solveCrossings(...)` ×3 interleaved with `offStuds(LIFT)`, wake moved cables (`still = 0`). Skip entirely when nothing is awake.
- [ ] Held cable: push a hook for every crossing where it is **under**.
- [ ] Both-ends pickup: drop all crossings of that cable.
- [ ] `npm run check`; commit.

### Task 4: Draw
**Files:** Modify `draw()` ~L1457–1600.
- [ ] Order: cords (deal order, held cable's plug-hole clipping kept) → seated plugs → cord-over-post patches (for each cable × stud where `!studsOn.has(key)` and the cord overlaps the barrel: clip disc r = BARREL×1.3 at the barrel midpoint, redraw that cord's local stretch) → crossing patches (clip disc r = width×1.3 at the crossing, redraw the over rope's local 5-point stretch with shadow) → held cable's lifted segment + held plug → flying plugs.
- [ ] `npm run check`; visual check in browser; commit.

### Task 5: Invariant test + old-behaviour proof
- [ ] Test: 3 ropes, 600 frames of scripted drags; record per-pair `over` at each frame; assert no flip while the pair stays in contact.
- [ ] Reproduce the old flip with a stub of the removed rank logic (per-cable rank recomputed from "crosses the other's plug") on the same script; assert it flips. Keep the stub in the test file only.
- [ ] Commit.
