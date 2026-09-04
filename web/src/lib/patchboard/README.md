# Patchboard

Independent experiment at `/patchboard`. It shares no physics or rendering code
with `/lab3d`. No additional runtime dependencies.

Drag an end to disconnect; release near an unoccupied socket to seat it. Release
elsewhere to drop it. Drag the cord body to form a loop. While holding, scroll up
to bring the grip out toward you, down to move toward the panel. Up/down arrow
keys also adjust depth. Right-drag (or Alt-drag) orbits the camera; scrolling
without a grip zooms. Escape drops the grip, R resets.

The Cable feel panel starts with **Stiffness & settling**: bending stiffness
now ranges up to 8, and settling strength independently damps broad cable
oscillations. **Try firm + fast settling** applies stiffness 5 and settling 24.
Settling removes velocity relative to the cable's mass-weighted center of
motion, preserving translational momentum and a kinematic held end. It is a
mode-damping approximation rather than a calibrated material model.

The panel also exposes motion damping, cable and surface
friction, body handling, stretch, connector weight, and socket hold.
Shape memory and socket alignment assist can be toggled independently.
Earth gravity is fixed at 9.81 m/s², always enabled, and cannot be changed by
presets or old saved settings. One scene unit is 5 cm: cable diameter is 6.5 mm,
board height is about 38 cm. The solver converts SI gravity to scene units.
Motion damping acts on relative velocities inside the cable; it does not add
global drag or slow the cable's center of mass in free fall.
Settings apply live and persist in localStorage; resetting the board preserves
them. Restore cable defaults resets the tuning. Presets are subjective starting
points, not calibrated specifications for any physical cable diameter.

Cable friction resolves relative tangential movement at capsule contacts, with
a static-slip threshold and a sliding correction limited by contact support.
Surface friction similarly limits tangential movement against the panel/floor.
Socket hold is a mouse pull-distance threshold, not measured extraction force.

`physics.ts` advances 73 particles per cord at a base 600 Hz using compliant length and
rest-curvature constraints. Full segment capsules provide inter-cord and
nonlocal self-collision; plugged-in shafts are additional solid capsules. The
floor and panel constrain movement, with damping and contact friction. Mouse
targets for the cord body apply bounded pulls. A held end is kinematic: it
tracks the mouse directly without spring lag or mass-dependent delay. Fast
hand paths are subdivided within the same display frame, sharing its elapsed
time so gravity is not accelerated. Only an unresolved collision or cable
extension limit can prevent the grip reaching the target. Socket alignment
assist acts on release, never redirects a plug while it is held.

The hand's hard extension limit uses the whole cord's material length. A
temporary stretch in one link at a bend does not imply that all slack is used.
Individual distance constraints still enforce local lengths, with additional
sweeps for difficult pulls. If a hand increment cannot be accepted, a retry
keeps the last safe grip position while allowing the surrounding cable to
redistribute slack; it no longer freezes the whole world with the grip.

Every step bounds particle displacement to less than half the cord radius and
validates segment clearance before accepting movement. Unresolved steps roll
back and damp velocity, preserving cord topology at the expense of motion in a
difficult contact configuration. This is a real-time approximation, not an
exact elastic-rod solver: there is no torsional material frame, friction uses
positional contact corrections, and very tight knots may stall. Normal slow
frames consume their full elapsed time with small collision subdivisions;
hidden tabs and gaps over 500 ms reset the frame clock. Each subdivision uses
3–6 constraint sweeps, with compliance adjusted for the timestep. Fast mouse
paths interpolate at a constant frame velocity, avoiding fictitious impulses.
Hot constraint loops avoid temporary vectors and repeated coefficient math.

Docking first pulls the plug and strain relief into alignment, checks clearance
for the inserted shaft, then locks the reached positions. It does not teleport
the plug to the cursor or a socket. Escape cancels a blocked docking attempt.
Pending insertions are independent of the mouse grip and reserve their sockets;
starting another drag cannot cancel them. An amber dashed ring marks a plug
still seating. Completing one insertion never releases a different held end.
Only directly grabbing a plug unseats it; collisions cannot detach seated plugs.
Escape while idle cancels pending insertions; while dragging it drops only the
held cord.

`view.ts` renders the actual 3D polyline as a tube with WebGL depth testing. The
floor and board shadows are illustrative projections, not shadow maps. The
canvas's `__patchboard()` method returns a diagnostic snapshot for testing,
including simulation time, scene scale, physics/render timings and substeps.

Checks:

```sh
npx vitest run test/patchboard.test.ts
node scripts/patchboard/check.mjs
node scripts/patchboard/drop-timing.mjs
node scripts/patchboard/notch-check.mjs
```

The browser check needs the dev server on port 3004 and a local Playwright
installation (optionally specified with `PLAYWRIGHT_CORE`). Physics tests cover
segment contacts, fixed sockets, falling to the floor, fast grip motion,
replugging, and a falling trefoil loop.
