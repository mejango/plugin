# Cord-board drag recordings

Each `recN.json` is a captured drag session from `/lab` (press `R` on the bench
to copy one). Shape: `{ seed, w, h, dpr, frames: [[mouseX,mouseY],...], events:
[[frame,"down"|"up",clientX,clientY],...] }`.

Replay one deterministically in headless (needs the dev server on :3004):
`node replay.mjs recN.json` — see the scratchpad harness. Same seed + frames
reproduces the exact panel and drag frame-for-frame, so a fixed bug stays fixed.

These are the regression corpus for cord-cord solidity (v11): each must replay
without a cord passing through another (no crossing dying except at a free end
or by a bight).
