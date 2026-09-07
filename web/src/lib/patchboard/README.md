# Patchboard

Independent experiment at `/patchboard`. It shares no physics or rendering code
with `/lab3d`. No additional runtime dependencies.

The homepage `/` and its `/patchboard-angle` preview use the same physics, with a
responsive, edge-to-edge socket grid. Desktop uses 12 columns; phones use four,
with intermediate column counts on tablets. Rows fill the available height
down to a slim brushed-chrome trim above a 16–32 pixel table foot. The trim
reserves space below the sockets and carries the supplied “A Revnet design” and “Runs on Juice” engraving artwork. It fills the viewport with white panel surfaces, pale hexagonal
socket nuts, and a narrow platform lip. The front camera is orthographic so
seated plugs and socket holes remain concentric at every depth; orbit uses
perspective. Column spacing stays at 1.05 scene units, while row spacing fits
the viewport. A responsive reflow rebuilds the physical board using the same
page seed and current cable-feel settings, rather than stretching live cables.
Multilingual signal labels, waveforms, circuit traces, and signal-flow boxes
reuse the homepage's design vocabulary. `artwork.ts` draws a texture once,
applied to the panel behind the sockets, cord shadows, and cords. There is no
bottom-left instruction overlay, tuning menu, status badge, or camera/reset
button bar on the homepage or preview. Molded plug
elbows have ribbed strain relief; unplugged ends expose tapered metal tips
with black insulating rings, within the existing collision geometry.
Two point lights, inset one-third of the panel width to either side, 0.4 units
above the top and 5 units out from the panel, illuminate the cords. Their shadows are
projected onto and clipped to the panel and floor, with round polyline joins.
The shadow silhouette includes the metal tip and molded housing. A seated
plug's shaft extends to its actual panel intersection, so both light projections
meet the socket; loose and still-docking ends have no artificial panel connection.
These are lightweight projected shadows, not full scene shadow maps (plugs
and cords do not cast shadows onto each other). Orbit remains available.
`/patchboard` keeps its original tuning panel and
presentation. It shares `experience.tsx` and the renderer with the public board.
Panel shadows are a faint 3% tint, preserve the engraving underneath, and
skip the cable-material lighting calculation. Table shadows are lighter too.
The cable jacket and molded plug boots use a restrained satin-rubber material:
soft highlights from the existing lights, slightly deeper edge shading, and a
shared 128×128 neutral grain texture. Rest-length surface coordinates keep the
grain attached as cables bend or stretch; mipmap filtering avoids sparkling at
small sizes. The texture is uploaded once and adds no geometry or draw passes.
Metal, panel artwork, sockets, and shadows keep their existing materials. There
is no animated noise, physics change, or extra work for sleeping cable meshes.
The front-on homepage draws a cool-white bitmap display into the board material,
replacing the first two socket rows across four columns on desktop (three on phones).
The first column, left of the screen, holds a continuous volume knob above a raised cyan NEW key, with
PLUG IN printed above it. These cells are removed from the physical socket grid;
cables can pass naturally in front of the display. The key's visible bottom aligns
with the display frame. Volume starts at zero, supports dragging and keyboard adjustment, and persists when visiting the workstation. No audio source is currently attached.
`HomeHero` defaults to Top by indexed USD backing, with Trending, New, and Latest activity views matching the Juicebox discovery categories. The View Mode knob sits right of the screen (below it on narrow phones), supports dragging between four detents, click, and arrow keys, and rotates with the selection. It fetches six V6 rows and publishes the readout to the
renderer, and provides an accessible table plus a matching invisible click target
for NOW. The renderer uses issued-token tickers and per-currency balances summed
across chains, with minute refreshes and loading, empty, and retry states. Sign in
uses the existing account flow. `PatchboardBackdrop` mounts the public
board in the shared app layout for `/`, `/patchboard-angle`, and `/create`.
NOW pans to a connected computer beside that same canvas and physical world; Back and
browser history preserve the exact arrangement, including user-unplugged ends.
The full form scrolls inside the larger monitor,
so navigating or scrolling does not resize/rebuild the board. The backdrop is
inert on `/create`, including its keyboard shortcuts, while the form is active.
Direct entry to `/create` initializes both devices with the camera on the workstation.
The homepage and creation form replace the former `PatchBay` background and
ignore saved experiment tuning. The approved defaults
are bending stiffness 8, settling 30, damping 8, cable grip 0.50, surface grip
0.95, body handling 0.35, stretch 0.01, and plug weight 3.75;
rest-shape memory and socket assist are both enabled. Experiment preferences
remain saved separately in the existing browser storage and are not deleted.
Run the browser regression against this variant with
`node scripts/patchboard/home-check.mjs` and
`PATCHBOARD_URL=http://localhost:3004/ node scripts/patchboard/check.mjs`.

Every page refresh chooses a new random seed and a collision-checked starting
patch, with roughly 4–18 cables depending on the remaining socket area scaled to screen area. Cable stock lengths are
3.6, 5.8, and 8.2 scene units (18, 29, and 41 cm); these are real rest lengths,
not different sag values for an otherwise identical cable. Random socket
pairs, colors, hanging depths, and subtle coil memory vary the arrangement.
Initial full-segment and inserted-shaft clearance is checked before a cable is
accepted; occupied sockets are never reused. Short landscape views may favor
the shorter stock sizes when a longer one cannot fit safely. Reset repeats the
current seed; refresh chooses a new one. `?seed=41` reproduces an arrangement,
and `?scene=classic` retains the three-cable fixture for focused regressions.
Before the first rendered frame, fully connected, collision-clear initial
placements start asleep with zero velocity, without a warmup simulation or any
change to their geometry or shape memory. Refresh, reset, and responsive reflow
all start still; grabbing a cable or an actual contact wakes the affected cables
normally. This initialization cannot freeze an active, loose, or intersecting
world. The experimental `/patchboard` keeps its normal startup simulation.
`node scripts/patchboard/layout-check.mjs` checks refresh randomization, seven
viewport shapes, stock lengths, socket coverage, and exact rest.
`node scripts/patchboard/startup-check.mjs` observes from before hydration to
check first-frame stillness and fresh random placements after refresh.
`node scripts/patchboard/navigation-check.mjs` checks canvas identity and exact
cord positions after handling, Now, form scrolling, Back, and browser history
on desktop and mobile, plus direct entry to the creation form.

Drag an end to disconnect; the default hand depth lifts it in front of other
cables, so crossing a separate cord goes over it. This changes the hand target,
not the collision geometry or existing topology: an obstructed lift still stops.
Wheel or up/down depth input opts out of this automatic lift for the current
drag. Release over an unoccupied socket to seat it. Socket assist brings a
raised end back to the board through collision-checked increments. Release
elsewhere to drop it. Drag the cord body to form a loop. While holding, scroll up
to bring the grip out toward you, down to move toward the panel. Up/down arrow
keys also adjust depth. Right-drag (or Alt-drag) orbits the camera; scrolling
without a grip only zooms on `/patchboard`; `/` and `/patchboard-angle` have no
scroll-to-zoom. Escape drops the grip, R resets, F restores the front
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
floor. Each supported cable staying inside a 0.035-unit movement window for 0.65
seconds sleeps with exactly zero velocity and no further position solving.
Unsupported midair groups cannot sleep or receive support damping. After 1.25
seconds untouched, supported groups also progressively dissipate residual
whole-cable swing (up to 4/s); mode damping alone preserves that translation.
Rest timers count elapsed time even when a collision rejects a solver substep.
A hand whose target has stopped moving for 0.18 seconds counts as stationary
support, allowing the held cable to settle and sleep too. Mouse movement or
release immediately wakes that cable; no input smoothing is applied.
While handling, momentum-preserving neighbor impulses damp short-wavelength
velocity ripples without modifying the kinematic endpoint or damping uniform
free-fall velocity. The broad swing still follows the cable-feel settings.

Grabbing wakes only that cable and loose cables that depend on it for support.
Socketed and floor-supported neighbors remain asleep until an actual contact
push displaces their flexible body. Tiny contact bias does not trigger a chain
reaction, and bumping a fixed plug is not a reason to animate its whole cable.
Contacts still propagate support, but each cable has independent rest timers.
Cached sleeping-segment bounds, resting-pair broad phase, and existing static
contacts avoid repeatedly searching the untouched part of the collision scene.
Moving capsules query the static bounds; cached pairs still participate in
collision solving immediately if either cable wakes during the step. External
changes are checked once per display frame, not again in every subdivision.
Settings changes
wake all groups. Obstructed insertions can rest while retaining their socket
reservation; a new grab wakes pending insertions so they can try again.
Diagnostics expose `sleeping` and per-cord `rest` timers. Run
`node scripts/patchboard/rest-check.mjs` to check exact stillness over successive
browser frames, wake-on-grab, and rest after dropping standard and firm cables.
It also checks exact rest while held and wake-on-mouse-movement before release.

Factory rest curvature is a gentle coil set with small deterministic differences
between cables, rather than a copy of their shared initial hanging pose. Bend
sweeps alternate directions and an angle constraint spreads localized sharp
bends across neighboring segments. While handled, shape memory slowly adapts
over 30 seconds to a seven-segment-smoothed curvature, clamped to gentle turns.
Idle solver chatter is never learned; switching shape memory off stops learning.
This stores bend magnitude, not a full torsional/oriented material frame.

The panel also exposes motion damping, cable and surface
friction, body handling, stretch, and connector weight.
Shape memory and socket alignment assist can be toggled independently.
Earth gravity is fixed at 9.81 m/s², always enabled, and cannot be changed by
presets or old saved settings. One scene unit is 5 cm: cable diameter is 6.5 mm,
board height is about 38 cm. The solver converts SI gravity to scene units.
Motion damping acts on relative velocities inside the cable; it does not add
global drag or slow the cable's center of mass in free fall.
Experiment settings apply live and persist in localStorage; resetting the board
preserves them. Restore cable defaults resets the tuning to the approved
homepage values. The public homepage always starts with those values instead
of the stored preferences. Alternative experiment presets remain unchanged.
Presets are subjective starting
points, not calibrated specifications for any physical cable diameter.

Cable friction resolves relative tangential movement at capsule contacts, with
a static-slip threshold and a sliding correction limited by contact support.
Surface friction similarly limits tangential movement against the panel/floor.
A seated plug releases on the first pointer movement while held, without a
pull-distance threshold. A click without movement leaves it connected. Wheel
or arrow-key depth movement also starts the drag immediately. Old saved socket
hold settings are ignored. `node scripts/patchboard/unplug-check.mjs` checks
immediate release, click/cancel safety, and pointer ownership in the browser.
The metal tip, elbow, and strain relief are picked as one connector, always
mapped to the physical endpoint. A floor plug takes priority over its own
folded cable body within the handle's hit area; another cable in front still
occludes it. This keeps plug handling and socket assistance active when a loose
connector is picked up sideways. `node scripts/patchboard/floor-check.mjs`
checks dropping both ends and re-inserting them from the floor at desktop and
phone sizes, including picking up the second end while the first is attached.

`physics.ts` uses about one particle per 0.115 scene units for the stock cables
(73 for the original three-cable fixture), at a base 600 Hz using compliant length and
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
Verified socket approaches work from the full table depth, without the old
seven-unit cutoff. They still travel through the solver, obey cable reach and
collisions, and lock only after reaching the exact seated pose. Manual-depth
placement without alignment assistance still requires socket proximity.
Escape while idle cancels pending insertions; while dragging it drops only the
held cord.

`view.ts` renders the actual 3D polyline as a tube with WebGL depth testing.
Each cable has its own GPU buffer. Only actual position or plug-state changes
rebuild its tube/shadows and upload that buffer; unchanged cables and the board
are reused even while another cable moves. An unchanged scene/camera performs
no WebGL redraw at all, and unchanged status does not rerender the React UI.
Moving frames still depth-compose the scene so occlusion remains correct. The
floor and board shadows are illustrative projections, not shadow maps. The
canvas's `__patchboard()` method returns a diagnostic snapshot for testing,
including simulation time, scene scale, physics/render timings and substeps.
`__patchboardTiming()` is a lightweight frame snapshot with `rebuiltCords`,
`uploadedBytes`, and `drawCalls`. `scripts/patchboard/performance-check.mjs`
checks remote-cable stillness, local GPU updates, and zero idle redraws on a
16-cable patch. `scripts/patchboard/home-check.mjs` checks the shared hero,
click-through cable dragging, actions, mobile sizing, disabled scroll zoom,
approved defaults despite saved experiment settings, and absent tuning/status UI.

Checks:

```sh
npm run check
npx vitest run test/patchboard.test.ts
node scripts/patchboard/check.mjs
node scripts/patchboard/drop-timing.mjs
node scripts/patchboard/notch-check.mjs
```

The browser check needs the dev server on port 3004 and a local Playwright
installation (optionally specified with `PLAYWRIGHT_CORE`). Physics tests cover
segment contacts, fixed sockets, falling to the floor, fast grip motion,
replugging, and a falling trefoil loop.

The app-wide check runs TypeScript, ESLint, the unused-code audit, and all unit
tests. `knip.jsonc` treats the browser regression scripts as explicit entry
points alongside Next routes and Vitest tests. The retained `/lab` and `/lab3d`
routes own their legacy engines directly; the former shared homepage wrapper
is no longer needed. Production is built by the root Dockerfile on Railway
when this repository's `main` branch is pushed.
### Programming a machine

`/create` pans the shared scene to a separate monitor connected to the patchboard through fitted plugs and a cable. The board has a beveled metal side rail; neither navigation nor form scrolling resizes its canvas or resets its physics.
`CreateForm` renders the complete form inside the monitor, including media uploads, charts, routes, operating rules, editable manual, review, chain choices, and deployment. There is no pagination, view toggle, or decorative keyboard. Drafts and manual edits survive returning to the board. Delayed autofocus never steals focus from a field the user has already started editing.
`node scripts/patchboard/create-check.mjs` checks form editing and narrow-screen overflow. `navigation-check.mjs` checks draft and cable preservation; `knobs-check.mjs` checks drag detents, continuous volume, keyboard input, and persisted knob values.

Pending insertions reserve clearance for the shaft and connector along the socket approach. A crossing cord keeps the plug outside the obstruction; clearing it wakes the blocked insertion once. Normal capsule collisions still govern all hand movement and insertion steps.

The socket below View Mode is reserved for four directional keys. Up/down select rows and fetch six-row pages; right opens cross-chain project stats and left returns to the same selection. Keyboard arrows work without focusing the terminal, while form fields and focused knobs retain their own keys. Footer counts come from the indexer totalCount. Run `node scripts/patchboard/terminal-check.mjs` for desktop/mobile navigation, pagination, stats, and retry checks.
