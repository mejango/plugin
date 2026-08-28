// Headless scenario suite for the 2.5D patch bay (/lab3d must be running on :3004).
//   node scripts/patchbay/run-all.mjs
// Each scenario drives the real engine through a pointer sequence and asserts on
// its debug hook (canvas.__pb3d()). They are the regression net for the plug
// rules — the unit tests in web/test cover the solver, not the interaction.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const run = (f, ...args) => JSON.parse(execFileSync("node", [join(here, f), ...args], { encoding: "utf8" }).trim().split("\n").pop());

// [file, args, what must hold, why]
const CASES = [
  ["loop.mjs", [], (r) => r.fired >= 0, "a loop wrapped round a plug and pulled pops that plug"],
  ["tugwall.mjs", [], (r) => r.firedAt >= 0, "an under-cord pulled taut into an over-cord pops its plug"],
  ["throughwall.mjs", [], (r) => r.firedAt < 0, "a cord merely shoved sideways into another pops nothing"],
  ["freecord.mjs", ["22"], (r) => r.clearBefore && r.maxWind > 3.5 && r.othersPlugsIntact, "a cord grabbed CLEAR of another rides over it: wrapping its plug pops nothing"],
  ["freecord.mjs", ["11"], (r) => r.clearBefore && r.maxWind > 3.5 && r.othersPlugsIntact, "...and again on another board"],
  ["carry.mjs", [], (r) => r.atTop[1] <= 45 && r.held[1] <= 45, "a cord with one end loose can be carried to the top of the board"],
];
// Also here, deliberately unasserted: hook.mjs — a shallow U round a post pulled
// sideways. It sits right on the edge of popping, and a cord hooked on a post
// from one side can legitimately slide off it, so either outcome is defensible.
// "a cord riding OVER another ignores its connector" has no scenario of its own:
// laying a cord across a plug and settling measures the length solve as much as
// the connector and does not repeat. freecord covers the property end to end.

let bad = 0;
for (const [file, args, ok, why] of CASES) {
  let r, pass = false;
  try { r = run(file, ...args); pass = ok(r); } catch (e) { r = { error: String(e).slice(0, 200) }; }
  if (!pass) bad++;
  const brief = Object.fromEntries(Object.entries(r).filter(([, v]) => !Array.isArray(v) || v.length <= 4));
  console.log(`${pass ? "ok  " : "FAIL"}  ${why}\n        ${file} ${args.join(" ")} -> ${JSON.stringify(brief)}`);
}
console.log(bad ? `\n${bad} failing` : "\nall scenarios pass");
process.exit(bad ? 1 : 0);
