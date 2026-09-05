# Patchboard

Independent experiment at `/patchboard`. It shares no physics or rendering code
with `/lab3d`. No additional runtime dependencies.

`/patchboard-angle` uses the same physics and saved cable settings, with a
dense 12-column, 7-row socket layout. It fills the viewport with white panel surfaces, pale hexagonal
socket nuts, and a narrow platform lip. The front camera is orthographic so
seated plugs and socket holes remain concentric at every depth; orbit uses
perspective. Framing refits on resize without changing socket spacing.
Multilingual signal labels, waveforms, circuit traces, and signal-flow boxes
reuse the homepage's design vocabulary. `artwork.ts` draws a texture once,
applied to the panel behind the sockets, cord shadows, and cords. There is no
bottom-left instruction overlay, page title, or camera/reset button bar in
this variant. The visible table foot is at most 48 pixels high. Molded plug
elbows have ribbed strain relief; unplugged ends expose tapered metal tips
with black insulating rings, within the existing collision geometry.
Two point lights at
(-4.1, 8.8, 5) and (4.1, 8.8, 5) illuminate the cords. Their cord shadows are
projected onto and clipped to the panel and floor, with round polyline joins.
These are lightweight projected shadows, not full scene shadow maps (plugs
and cords do not cast shadows onto each other). Orbit remains available; the
tuning panel starts collapsed on this route. `/patchboard` keeps its original
presentation. Both routes share `experience.tsx` and the same renderer.
Run the browser regression against this variant with
`PATCHBOARD_URL=http://localhost:3004/patchboard-angle node scripts/patchboard/check.mjs`.

Drag an end to disconnect; the default hand depth lifts it in front of other
cables, so crossing a separate cord goes over it. This changes the hand target,
not the collision geometry or existing topology: an obstructed lift still stops.
Wheel or up/down depth input opts out of this automatic lift for the current
drag. Release over an unoccupied socket to seat it. Socket assist brings a
raised end back to the board through collision-checked increments. Release
elsewhere to drop it. Drag the cord body to form a loop. While holding, scroll up
to bring the grip out toward you, down to move toward the panel. Up/down arrow
keys also adjust depth. Right-drag (or Alt-drag) orbits the camera; scrolling
without a grip zooms. Escape drops the grip, R resets, F restores the front
view, and O selects the orbit view.

The Cable feel panel starts with **Stiffness & settling**: bending stiffness
now ranges up to 8, and settling strength independently damps broad cable
oscillations. **Try firm + fast settling** applies stiffness 5 and settling 24.
Settling removes velocity relative to the cable's mass-weighted center of
motion, preserving translational momentum and a kinematic held end. It is a
mode-damping approximation rather than a calibrated material model.

Idle cables retain a minimum mode damping of 3, even when the settling slider
is zero. Real cord/plug contacts form independent rest groups. Support propagates
from plugged ends, floor contact, frictional panel contact, and pending insertion
constraints through each group; loose cords can rest on other cables above the
floor. A supported group staying inside a 0.035-unit movement window for 0.65
seconds sleeps with exactly zero velocity and no further position solving.
Unsupported midair groups cannot sleep or receive support damping. After 1.25
seconds untouched, supported groups also progressively dissipate residual
whole-cable swing (up to 4/s); mode damping alone preserves that translation.
Rest timers count elapsed time even when a collision rejects a solver substep.

Grabbing or contacting a sleeping cable wakes its touching group immediately,
without waking unrelated cables or detaching any other plug. Settings changes
wake all groups. Obstructed insertions can rest while retaining their socket
reservation; a new grab wakes pending insertions so they can try again.
Diagnostics expose `sleeping` and per-cord `rest` timers. Run
`node scripts/patchboard/rest-check.mjs` to check exact stillness over successive
browser frames, wake-on-grab, and rest after dropping standard and firm cables.

Factory rest curvature is a gentle coil set with small deterministic differences
between cables, rather than a copy of their shared initial hanging pose. Bend
sweeps alternate directions and an angle constraint spreads localized sharp
bends across neighboring segments. While handled, shape memory slowly adapts
over 30 seconds to a seven-segment-smoothed curvature, clamped to gentle turns.
Idle solver chatter is never learned; switching shape memory off stops learning.
This stores bend magnitude, not a full torsional/oriented material frame.

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

Docking advances the plug and strain relief as temporary kinematic placements,
each bounded by the normal sub-radius movement limit, so cable tension cannot
balance the alignment spring in a permanently half-inserted pose. Both positions
must reach the exact seated pose, with valid cable length, connector clearance,
and inserted-shaft clearance, before either is locked or counted as connected.
An obstructed, resting insertion is explicitly labeled **NOT SEATED** on the
board and in the status footer. It does not teleport
the plug to the cursor or a socket. Escape cancels a blocked docking attempt.
Pending insertions are independent of the mouse grip and reserve their sockets;
starting another drag cannot cancel them. An amber dashed ring marks a plug
still seating. Completing one insertion never releases a different held end.
Only directly grabbing a plug unseats it; collisions cannot detach seated plugs.
The pointer and visible plug must both be over the actual 0.091-unit socket
aperture on release, not its rim or a padded screen-space snap zone. Final
seating centers the endpoint exactly, with a sub-radius correction checked
against cord and shaft collisions before it is locked.
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
