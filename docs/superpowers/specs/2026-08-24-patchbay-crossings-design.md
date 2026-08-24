# Patch bay: crossings as sliding rings

**Date:** 2026-08-24 · **Status:** approved · **Replaces:** per-cable z-order in `web/src/lib/patchbay.ts`

## Goal

Make the background patch bay behave like a real one. Cords are fixed length, plugs
seat only in free holes, and *no cord ever passes through another cord or a seated
plug.* A weave is allowed — one cord over another here, under it there — as long as
it pulls its neighbours the way a real cord would and can be undone by dragging the
right end back through.

Test of every rule: **is this how a physical system would work?** (see memory note
`physical-plausibility-test`).

## Why a rewrite

Layering today is one integer per cable, scored by how many seated connectors the
cord runs over, plus a stack of contact-history rules (already-resting, met-afresh,
knot-breaking, reach limits). The physics is per-*crossing*; the state is per-*cable*.
Every rule is a patch squeezing one into the other, and each fix breaks the next
case. Commit `605cd23` ("a crossing is a thing") was the right model and was reverted
because it applied one-shot pulls to cached points (twitching, stale anchors). This
design keeps the model and fixes the mechanism.

The Verlet rope — bend memory, fold limit, strain relief, length controller, sleep —
is unchanged. The feel stays.

## 1. State

- Cables unchanged. Each end is **seated** (in a jack: a post), **held** (in hand), or
  **flying** (animating to a jack; treated as held).
- `crossings: Crossing[]`, global:
  `{ a, b, ia, ta, ib, tb, over }` — cable indices, segment index and fraction along
  each cable, `over ∈ { a, b }`. Identity is the object; position is re-derived every
  frame. **`over` is written at birth and never again.**
- `overPost: Set<string>` keyed `"cable:otherCable:end"` — cord `cable` lies across
  the seated plug of `otherCable`'s end. Replaces the z score.
- Deleted: `zOrder` scoring, `touching`, `lastMoved`, `restack`/`restacking`/
  `allQuiet`, the crossing-based hand-reach limit, met-afresh / already-resting logic.

## 2. Crossing life-cycle

Runs once per frame, only while some end is held or flying. A settled panel changes
nothing — this is also what keeps it asleep.

**Track.** For each crossing, search for the segment intersection between cable `a`
segments `ia−1..ia+1` and cable `b` segments `ib−1..ib+1` — a neighbourhood on both
cables, never a cached point. Found → update `ia/ta/ib/tb`. Not found → death check.

**Birth.** Every segment-pair intersection not claimed by a tracked crossing is new.
`over` = the cable that moved into it: the held cable if one is involved, otherwise
the one whose points moved further this frame (a swinging cord lands on top of a
still one). Segments in a lifted zone (§4) are always born `over`.

**Death** — only these three:
1. Lost within one segment of a **held/flying** end of either cable: the hand carried
   it clear. Gone.
2. It and another crossing of the same pair, adjacent on both cables, with the
   **same** `over`, both lost this frame: a bight slid out (annihilation). Gone.
3. Anything else means a cord went through a cord. **Not allowed:** the crossing is
   kept at its last `ia/ta/ib/tb` and the solver (§3) pulls the cables back together.
   Because the ring was solved last frame this is a sub-segment miss, never a jump.

A crossing at a **seated** end never dies: the end is a post and the cord is stuck
against it. Length runs out through the ring, so the hand stops short. There is no
separate reach rule.

Mixed-`over` adjacent pairs (over then under) never annihilate — that is a wrap, and it
is undone only by a held end coming back through (death 1).

## 3. Solver: the ring

Inside the length-solver loop, after each length pass, for each crossing:
`P = point(a, ia, ta)`, `Q = point(b, ib, tb)`. If `|P−Q| > width/2`, move the
two together. Sharing:
- a pinned (seated) end takes none;
- on the held cable, the first segment out of the held end takes none (hand wins);
- otherwise split equally between the two cables, and within a cable between the
  segment's two points by `1−t` / `t`.

`prev` moves with `pts` — the correction changes position without inventing velocity,
the same discipline as `relaxBendMemory`. Any cable moved by a ring is woken. This is
the coupling: a stuck under-cord hauls the over-cord along; a wrap holds.

## 4. Hand and posts

- Seated plug = capsule obstacle (existing `offStuds`) for every segment **except**
  segments in the lifted zone and cords with `overPost` for that plug.
- Held/flying plug: no obstacle, passes over everything (existing).
- **Lifted zone:** the cord within one plug-length of a held end. It ignores posts and
  cords. Crossings it creates are born `over`. Whatever it lies across when the plug
  seats gets an `over` crossing or an `overPost` flag. This is the only way a cord gets
  onto a post: you carry it there.
- Seating a plug in a hole under a cord sets `overPost` for that cord. Cleared when the
  cord no longer touches the barrel.
- Both ends held: the whole cable is lifted; all its crossings die on pickup and it
  lands `over` everything. You picked the cable up.

## 5. Drawing

Plugs-under, all cords in deal order, plugs-over — fixed, no sorting. Then per crossing:
clip to a disc of radius ≈ cord width at the crossing point and redraw the over cord's
local stretch with its shadow. Per `overPost`: same disc over the plug. Self-crossings
keep the existing arc-position code.

## 6. Tests

Pure functions in `web/src/lib/patchbay-crossings.ts` (track / birth / death / solve),
driven by the hand-rolled loop pattern already in `web/test/`.

- **Invariant:** random drags on a 3-cable board; for every pair in contact at frames
  k and k+1, `over` never flips. Show it failing on the old per-cable order first.
- **Wrap:** A over B then under B; drag A's end away → B is pulled, A stops when length
  runs out; drag it back through → crossings die in order, A comes free.
- **Bight:** under-cord U beneath a straight cord, pulled back → annihilation, no
  residue crossing.
- **Post:** cord dragged into a seated plug from clear stops; carried over it by its
  held end → `overPost`, rests on top.
- **Settled:** zero crossing changes over 600 idle frames.

## Files

- new `web/src/lib/patchbay-crossings.ts` (~250 lines)
- `web/src/lib/patchbay.ts`: remove layering stack (~400 lines), call the new module
  from `step()` and `draw()`
- new `web/test/patchbay-crossings.test.ts`

## Out of scope

True 2.5D height simulation (approach B); only if A proves insufficient.
