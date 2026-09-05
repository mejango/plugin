import { describe, expect, it } from "vitest";
import { closest, distance, v } from "../src/lib/patchboard/math";
import { PatchWorld, PLUG_RADIUS, RADIUS, STEP, EARTH_GRAVITY, METERS_PER_UNIT, dampCableModes } from "../src/lib/patchboard/physics";
import { frameSeconds } from "../src/lib/patchboard/clock";
import { DEFAULT_FEEL, FEEL_PRESETS, sanitizeFeel } from "../src/lib/patchboard/settings";

describe("physical patchboard", () => {
  it("quickly settles a broad wave without damping translation or a held plug", () => {
    const w = new PatchWorld(), nodes = w.cords[0].nodes;
    nodes.forEach((n, i) => { n.mass = i === 0 ? 1 / 3 : 1; n.velocity = v(Math.sin(i / (nodes.length - 1) * Math.PI * 2), -4, 2); });
    const momentum = () => nodes.reduce((sum, n) => sum + n.velocity.x / n.mass, 0);
    const totalMass = nodes.reduce((sum, n) => sum + 1 / n.mass, 0);
    const center = momentum() / totalMass;
    const energy = () => nodes.reduce((sum, n) => sum + (n.velocity.x - center) ** 2 / n.mass, 0);
    const initialMomentum = momentum(), initialEnergy = energy();
    dampCableModes(nodes, 24, 0.25);
    expect(energy()).toBeLessThan(initialEnergy * 0.001);
    expect(momentum()).toBeCloseTo(initialMomentum, 9);
    expect(nodes.every(n => n.velocity.y === -4 && n.velocity.z === 2)).toBe(true);
    nodes[0].velocity = v(20, -10, 5);
    dampCableModes(nodes, 30, 0.25, nodes[0]);
    expect(nodes[0].velocity).toEqual(v(20, -10, 5));
  });
  it("preserves elapsed time at lower frame rates and pauses after suspension", () => {
    expect(frameSeconds(1000, 1100)).toBeCloseTo(0.1);
    expect(frameSeconds(1000, 1050)).toBeCloseTo(0.05);
    expect(frameSeconds(null, 1100)).toBe(0);
    expect(frameSeconds(1000, 2000)).toBe(0);
  });
  it("keeps Earth free fall unchanged by material damping or old gravity settings", () => {
    for (const damping of [0, 8]) {
      const w = new PatchWorld();w.cords = w.cords.slice(0, 1);
      w.configure(sanitizeFeel({ ...DEFAULT_FEEL, damping, gravity: 0, gravityEnabled: false }));
      const c = w.cords[0];c.ports = [null, null];
      c.nodes.forEach(n => { n.mass = 1; n.velocity = v(); });
      const centerY=()=>c.nodes.reduce((sum,n)=>sum+n.p.y,0)/c.nodes.length;
      const y = centerY();
      // Use the public elapsed-time stepper so collision subdivisions cannot
      // impose a terminal speed. Bound semi-implicit integration error.
      w.advance(0.1);
      // Material rest curvature may deform the cable during free fall; its
      // center of mass, not a particular bending node, follows Earth gravity.
      const drop = (y - centerY()) * METERS_PER_UNIT;
      expect(drop).toBeGreaterThanOrEqual(EARTH_GRAVITY * 0.1 ** 2 / 2 - 1e-8);
      expect(drop).toBeLessThanOrEqual(EARTH_GRAVITY * 0.1 * (0.1 + STEP) / 2 + 1e-8);
      expect(w.simulationTime).toBeCloseTo(0.1, 6);
      expect("gravity" in w.feel).toBe(false);
    }
  });
  it("tracks a freely held end in the same frame, independent of mass and damping", () => {
    const w = new PatchWorld();
    w.configure({ ...DEFAULT_FEEL, damping: 8, plugWeight: 6, grip: 0.04 });
    w.grab(0, 0);
    const start = { ...w.cords[0].nodes[0].p };
    for (const [x, y, z] of [[0, -0.2, 0.8], [0.8, -0.3, 1], [0.6, -0.6, 0.9]]) {
      const target = v(start.x + x, start.y + y, start.z + z);
      w.grip!.target = target;w.advance(1 / 60);
      expect(distance(w.cords[0].nodes[0].p, target)).toBeLessThan(0.001);
      expect(w.diagnostics().penetration).toBeLessThan(0.004);
    }
  });
  it("surface grip stops sliding while a frictionless cable keeps moving", () => {
    const slide = (friction: number) => {
      const w = new PatchWorld();w.cords = w.cords.slice(0, 1);
      w.configure({ ...DEFAULT_FEEL, floorFriction: friction, damping: 0 });
      const c = w.cords[0]; c.ports = [null, null];
      c.nodes.forEach((n, i) => { n.p = v((i - 36) * 0.15, RADIUS + 0.001, 3); n.old = { ...n.p }; n.velocity = v(0.4, 0, 0); n.radius = RADIUS; n.mass = 1; });
      c.rest.fill(0.15);c.bend.fill(0.3);
      for (let i = 0; i < 240; i++) w.step();
      return c.nodes[36].p.x;
    };
    expect(slide(0)).toBeGreaterThan(0.4 * 240 * STEP * 0.9);
    expect(slide(1)).toBeLessThan(0.05);
  });
  it("presets keep contacts valid and settings reject invalid stored values", () => {
    expect(sanitizeFeel({ damping: 999, grip: NaN, gravityEnabled: false }).damping).toBe(8);
    expect(sanitizeFeel({ grip: NaN }).grip).toBe(DEFAULT_FEEL.grip);
    for (const preset of Object.values(FEEL_PRESETS)) {
      const w = new PatchWorld();w.configure(preset);w.grab(0, 0);w.release();
      for (let i = 0; i < 360; i++) w.step();
      expect(w.diagnostics().finite).toBe(true);
      expect(w.diagnostics().penetration).toBeLessThan(0.004);
      w.reset();expect(w.feel).toEqual(preset);
    }
  });
  it("finds interior capsule contacts and handles parallel and collapsed segments", () => {
    expect(closest(v(-1,0,0),v(1,0,0),v(0,-1,0.1),v(0,1,0.1)).distance).toBeCloseTo(0.1);
    expect(closest(v(),v(1,0,0),v(0,1,0),v(1,1,0)).distance).toBeCloseTo(1);
    expect(closest(v(),v(),v(1,0,0),v(2,0,0)).distance).toBeCloseTo(1);
  });
  it("settles while preserving sockets and bounded extension", () => {
    const w = new PatchWorld();
    const start = w.cords.map(c => ({ ...c.nodes[0].p }));
    for(let i=0;i<720;i++) w.step();
    expect(w.diagnostics().finite).toBe(true);
    expect(w.diagnostics().penetration).toBeLessThan(0.003);
    expect(w.diagnostics().stretch).toBeLessThan(1.15);
    expect(w.rejectedSteps).toBeLessThan(60);
    w.cords.forEach((c,i)=>expect(distance(c.nodes[0].p,start[i])).toBe(0));
  });
  it("drops a disconnected cord to the floor", () => {
    const w = new PatchWorld();
    w.grab(0,0);w.release();w.grab(0,72);w.release();
    // Isolate floor support from panel friction, which can hold a bent cable
    // against the board above the floor.
    w.cords[0].nodes.forEach(n => { n.p.z += 2; n.old.z += 2; });
    for(let i=0;i<1800;i++)w.step();
    const c=w.cords[0];
    expect(c.ports).toEqual([null,null]);
    // A plug may rest on the fallen cable itself, one cable diameter above
    // the floor. Require physical support, not an exact floor height.
    for (const end of [0, 72]) {
      const p = c.nodes[end].p;
      const collar = c.nodes[end === 0 ? 1 : 71];
      const collarOnFloor = collar.p.y - collar.radius < 0.01 && distance(p, collar.p) < c.rest[end === 0 ? 0 : 71] * 1.15;
      const supported = p.y < PLUG_RADIUS + 0.05 || collarOnFloor || c.nodes.slice(1).some((b, i) => {
        if (Math.abs(i - end) < 4) return false;
        const a = c.nodes[i], contact = closest(p, p, a.p, b.p);
        return contact.q.y < p.y - 0.03 && contact.distance < PLUG_RADIUS + Math.max(a.radius, b.radius) + 0.025;
      });
      expect(supported, JSON.stringify({ p, collar: collar.p, diagnostics: w.diagnostics() })).toBe(true);
    }
    expect(Math.min(...c.nodes.map(n => n.p.y - n.radius))).toBeLessThan(0.01);
    expect(Math.min(...c.nodes.map(n=>n.p.y-n.radius))).toBeGreaterThanOrEqual(-0.002);
    expect(w.diagnostics().finite).toBe(true);
  });
  it("bounds fast mouse motion and preserves contacts against another cord", () => {
    const w = new PatchWorld();
    w.grab(0,36);
    w.grip!.target=v(5,3,0.3);
    for(let i=0;i<900;i++) {
      const before={...w.cords[0].nodes[36].p};w.step();
      expect(distance(before,w.cords[0].nodes[36].p)).toBeLessThanOrEqual(RADIUS*0.421);
      expect(w.diagnostics().penetration).toBeLessThan(0.004);
    }
    expect(w.diagnostics().finite).toBe(true);
  });
  it("seats a released plug without teleportation and refuses occupied sockets", () => {
    const w=new PatchWorld();w.grab(0,0);w.release(3);
    expect(w.grip).toBeNull();expect(w.cords[0].ports[0]).toBeNull();
    w.grab(0,0);w.release(0);
    for(let i=0;i<240;i++)w.step();
    expect(w.cords[0].ports[0]).toBe(0);
  });
  it("moves a plug to a different socket through space", () => {
    const w = new PatchWorld();w.grab(0,0);
    w.grip!.target=v(w.sockets[1].x,w.sockets[1].y,0.9);
    for(let i=0;i<600;i++)w.step();
    w.grip!.target={...w.sockets[1]};
    for(let i=0;i<600;i++)w.step();
    expect(distance(w.cords[0].nodes[0].p,w.sockets[1])).toBeLessThan(0.3);
    w.release(1);
    for(let i=0;i<600;i++)w.step();
    expect(w.cords[0].ports[0]).toBe(1);
    expect(w.cords[0].nodes[0].p).toEqual(w.sockets[1]);
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
  });
  it("keeps a loose trefoil loop self-colliding while it falls", () => {
    const w=new PatchWorld();w.cords=w.cords.slice(0,1);
    const c=w.cords[0];c.ports=[null,null];
    c.nodes.forEach((n,i)=>{
      const t=0.2+i/(c.nodes.length-1)*(Math.PI*2-0.4);
      n.p=v(0.7*(Math.sin(t)+2*Math.sin(2*t)),4+0.7*(Math.cos(t)-2*Math.cos(2*t)),2+0.7*Math.sin(3*t));
      n.old={...n.p};n.velocity=v();n.mass=1;
    });
    c.rest=c.nodes.slice(1).map((n,i)=>distance(n.p,c.nodes[i].p));
    c.bend=c.nodes.slice(2).map((n,i)=>distance(n.p,c.nodes[i].p));
    expect(w.diagnostics().penetration).toBeLessThan(0.003);
    for(let i=0;i<960;i++)w.step();
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
    expect(w.diagnostics().finite).toBe(true);
    expect(w.rejectedSteps).toBeLessThan(700);
    expect(Math.min(...c.nodes.map(n=>n.p.y))).toBeLessThan(0.2);
  });
});
