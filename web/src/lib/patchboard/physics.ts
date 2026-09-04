import { add, clamp, closest, distance, dot, length, lerp, move, mul, sub, unit, v, type V3 } from "./math";
import { DEFAULT_FEEL, sanitizeFeel, type CableFeel } from "./settings";

export const RADIUS = 0.065;
export const STEP = 1 / 600;
export const EARTH_GRAVITY = 9.81;
// One scene unit is 5 cm: the 0.13-unit cable is 6.5 mm thick and the
// 7.55-unit board is about 38 cm high, rather than a 7.55-metre wall.
export const METERS_PER_UNIT = 0.05;
export const SCENE_GRAVITY = EARTH_GRAVITY / METERS_PER_UNIT;
export const PLUG_RADIUS = 0.125;
const COUNT = 73;
const TRAVEL = RADIUS * 0.42;
export type Particle = { p: V3; old: V3; velocity: V3; mass: number; radius: number };
export type Cord = { color: number[]; nodes: Particle[]; rest: number[]; bend: number[]; ports: [number | null, number | null] };
export type Grip = { cord: number; index: number; target: V3; dock: number | null };
type Segment = { a: Particle; b: Particle; cord: number; index: number; radius: number; min: V3; max: V3 };

// Dampen whole-cable deformation, including broad low-frequency waves that
// neighbour-only damping barely affects. Preserve translational momentum so
// this cannot slow free fall. A kinematic hand is never modified.
export function dampCableModes(nodes: Particle[], strength: number, dt: number, held: Particle | null = null) {
  if (strength === 0) return;
  let mass=0,x=0,y=0,z=0;
  for(const n of nodes)if(n.mass&&n!==held){const m=1/n.mass;mass+=m;x+=n.velocity.x*m;y+=n.velocity.y*m;z+=n.velocity.z*m;}
  if(!mass)return;
  x/=mass;y/=mass;z/=mass;
  const retain=Math.exp(-strength*dt);
  for(const n of nodes)if(n.mass&&n!==held){
    n.velocity.x=x+(n.velocity.x-x)*retain;
    n.velocity.y=y+(n.velocity.y-y)*retain;
    n.velocity.z=z+(n.velocity.z-z)*retain;
  }
}

export class PatchWorld {
  sockets = Array.from({ length: 30 }, (_, i) => v((i % 10 - 4.5) * 1.05, 6.4 - Math.floor(i / 10) * 1.35, 0.30));
  cords: Cord[] = [];
  grip: Grip | null = null;
  docking: Grip[] = [];
  feel = { ...DEFAULT_FEEL };
  rejectedSteps = 0;
  steps = 0;
  simulationTime = 0;
  lastRejection: "contact" | "extension" | null = null;
  private contacts = new Set<Particle>();
  private retryVelocities = new Float64Array(0);

  constructor() { this.reset(); }

  configure(settings: CableFeel) {
    this.feel = sanitizeFeel(settings);
    for (const c of this.cords) for (const i of [0, COUNT - 1]) {
      if (c.nodes[i].mass) c.nodes[i].mass = 1 / this.feel.plugWeight;
    }
  }

  reset() {
    this.grip = null;
    this.docking = [];
    this.rejectedSteps = 0;
    this.steps = 0;
    this.simulationTime = 0;
    this.lastRejection = null;
    this.cords = [[0, 2], [3, 5], [7, 9]].map(([a, b], ci) => {
      const start = this.sockets[a], end = this.sockets[b];
      const curve = Array.from({ length: 501 }, (_, i) => {
        const t = i / 500, p = lerp(start, end, t);
        p.y -= 3.8 * Math.sin(Math.PI * t);
        p.z += 0.22 + 0.55 * Math.sin(Math.PI * t);
        return p;
      });
      const arc = [0];
      for (let i = 1; i < curve.length; i++) arc.push(arc[i - 1] + distance(curve[i - 1], curve[i]));
      const nodes = Array.from({ length: COUNT }, (_, i): Particle => {
        const target = clamp((i - 1) / (COUNT - 3), 0, 1) * arc[500];
        let j = 1;
        while (j < 500 && arc[j] < target) j++;
        const p = i === 0 ? { ...start } : i === COUNT - 1 ? { ...end } : lerp(curve[j - 1], curve[j], (target - arc[j - 1]) / (arc[j] - arc[j - 1]));
        return { p, old: { ...p }, velocity: v(), mass: i < 2 || i > COUNT - 3 ? 0 : 1, radius: i < 2 || i > COUNT - 3 ? PLUG_RADIUS : RADIUS };
      });
      return {
        nodes, color: [[0.91, 0.28, 0.13], [0.17, 0.49, 0.70], [0.77, 0.64, 0.27]][ci],
        rest: nodes.slice(1).map((n, i) => distance(nodes[i].p, n.p)),
        bend: nodes.slice(2).map((n, i) => distance(nodes[i].p, n.p)),
        ports: [a, b] as [number, number],
      };
    });
  }

  occupied(port: number) { return this.cords.some(c => c.ports.includes(port)) || this.docking.some(d => d.dock === port); }

  cancelDocking() { this.docking = []; }

  grab(cord: number, index: number) {
    this.release();
    const c = this.cords[cord];
    if (index < 2 || index > c.nodes.length - 3) {
      const end = index < 2 ? 0 : 1;
      c.ports[end] = null;
      index = end === 0 ? 0 : c.nodes.length - 1;
      // Only directly grabbing this end may cancel its pending insertion.
      this.docking = this.docking.filter(d => d.cord !== cord || d.index !== index);
      c.nodes[index].mass = 1 / this.feel.plugWeight;
      c.nodes[index + (end === 0 ? 1 : -1)].mass = 0.8;
    }
    this.grip = { cord, index, target: { ...c.nodes[index].p }, dock: null };
  }

  release(port: number | null = null) {
    const g = this.grip;
    if (g && port !== null && !this.occupied(port) && (g.index === 0 || g.index === COUNT - 1)) {
      // Dock by pulling to the socket. Never teleport an end on mouse-up.
      const p = this.cords[g.cord].nodes[g.index].p;
      if (distance(p, this.sockets[port]) < 0.65) {
        this.docking.push({ ...g, dock: port, target: { ...this.sockets[port] } });
        this.grip = null;
        return;
      }
    }
    this.grip = null;
  }

  private segments(): Segment[] {
    const segments: Segment[] = [];
    this.cords.forEach((c, ci) => {
      for (let i = 0; i < c.nodes.length - 1; i++) {
        const a = c.nodes[i], b = c.nodes[i + 1], r = Math.max(a.radius, b.radius);
        segments.push({ a, b, cord: ci, index: i, radius: r,
          min: v(Math.min(a.p.x, b.p.x) - r - TRAVEL * 2, Math.min(a.p.y, b.p.y) - r - TRAVEL * 2, Math.min(a.p.z, b.p.z) - r - TRAVEL * 2),
          max: v(Math.max(a.p.x, b.p.x) + r + TRAVEL * 2, Math.max(a.p.y, b.p.y) + r + TRAVEL * 2, Math.max(a.p.z, b.p.z) + r + TRAVEL * 2) });
      }
      c.ports.forEach((port, end) => {
        if (port === null) return;
        const b = c.nodes[end === 0 ? 0 : COUNT - 1];
        const p = v(b.p.x, b.p.y, 0);
        const a: Particle = { p, old: { ...p }, velocity: v(), mass: 0, radius: PLUG_RADIUS };
        segments.push({ a, b, cord: ci, index: end === 0 ? -1 : COUNT - 1, radius: PLUG_RADIUS,
          min: v(p.x - PLUG_RADIUS - TRAVEL * 2, p.y - PLUG_RADIUS - TRAVEL * 2, -PLUG_RADIUS),
          max: v(p.x + PLUG_RADIUS + TRAVEL * 2, p.y + PLUG_RADIUS + TRAVEL * 2, b.p.z + PLUG_RADIUS + TRAVEL * 2) });
      });
    });
    return segments.sort((a, b) => a.min.x - b.min.x);
  }

  private pairs(segments: Segment[]) {
    const pairs: [Segment, Segment][] = [];
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (b.min.x > a.max.x) break;
      // Local neighbours share a continuous bend, not a collision surface.
      if (a.cord === b.cord && Math.abs(a.index - b.index) <= 3) continue;
      if (a.max.y < b.min.y || b.max.y < a.min.y || a.max.z < b.min.z || b.max.z < a.min.z) continue;
      pairs.push([a, b]);
    }
    return pairs;
  }

  private constrain(a: Particle, b: Particle, rest: number, compliance: number) {
    if (a.mass + b.mass === 0) return;
    const x=b.p.x-a.p.x,y=b.p.y-a.p.y,z=b.p.z-a.p.z;
    const len=Math.sqrt(x*x+y*y+z*z);
    if (len < 1e-9) return;
    const correction=(len-rest)/(len*(a.mass+b.mass+compliance));
    const wa=correction*a.mass,wb=correction*b.mass;
    a.p.x+=x*wa;a.p.y+=y*wa;a.p.z+=z*wa;
    b.p.x-=x*wb;b.p.y-=y*wb;b.p.z-=z*wb;
  }

  private collide(a: Segment, b: Segment) {
    const c = closest(a.a.p, a.b.p, b.a.p, b.b.p);
    const gap = a.radius + b.radius + 0.0015 - c.distance;
    if (gap <= 0) return;
    const n = c.distance > 1e-8 ? mul(sub(c.p, c.q), 1 / c.distance) : unit(sub(lerp(a.a.old, a.b.old, c.s), lerp(b.a.old, b.b.old, c.t)));
    const weights = [1 - c.s, c.s, 1 - c.t, c.t];
    const nodes = [a.a, a.b, b.a, b.b];
    const inv = nodes.reduce((sum, p, i) => sum + p.mass * weights[i] ** 2, 0);
    if (!inv) return;
    nodes.forEach((p, i) => {
      move(p.p, n, (i < 2 ? 1 : -1) * p.mass * weights[i] * gap / inv);
      if (p.mass) this.contacts.add(p);
    });
    // Tangential contact friction transfers motion between cables instead of
    // merely damping each cable independently. Small slips stick statically.
    const slip = sub(sub(c.p, lerp(a.a.old, a.b.old, c.s)), sub(c.q, lerp(b.a.old, b.b.old, c.t)));
    const tangent = sub(slip, mul(n, dot(slip, n))), travel = length(tangent);
    if (travel > 1e-9) {
      const limit = this.feel.cordFriction * gap;
      const amount = travel <= limit * 1.4 ? travel : Math.min(travel, limit);
      nodes.forEach((p, i) => move(p.p, tangent, (i < 2 ? -1 : 1) * p.mass * weights[i] * amount / (inv * travel)));
    }
  }

  advance(duration: number) {
    // Resolve the entire hand path within this display frame. Extra collision
    // subdivisions share the same elapsed time; fast dragging doesn't speed
    // up gravity and doesn't impose a fixed units-per-second hand speed.
    const g = this.grip;
    const direct = g && g.dock === null && (g.index === 0 || g.index === COUNT - 1);
    const travel = direct ? distance(this.cords[g.cord].nodes[g.index].p, g.target) : 0;
    let speed = 0;
    this.cords.forEach((c, ci) => c.nodes.forEach((n, i) => {
      if (n.mass && !(direct && ci === g.cord && i === g.index)) speed = Math.max(speed, length(n.velocity));
    }));
    // Falling objects need extra subdivisions too: the collision travel bound
    // must not become an artificial terminal velocity.
    const count = Math.max(1, Math.ceil(duration / STEP), Math.ceil(travel / TRAVEL), Math.ceil((speed + SCENE_GRAVITY * duration) * duration / TRAVEL));
    const dt = Math.max(0.000001, duration / count);
    const handStart = direct ? { ...this.cords[g.cord].nodes[g.index].p } : null;
    const handTarget = direct ? { ...g.target } : null;
    for (let i = 0; i < count; i++) {
      // Move the hand at its actual frame velocity. Reaching the target in
      // the first few tiny substeps injects a fictitious high-speed impulse.
      if (direct && handStart && handTarget) g.target = lerp(handStart, handTarget, (i + 1) / count);
      const progressed=this.step(dt);
      // A blocked hand must not spend hundreds of iterations retrying the
      // same contact. Try again next display frame when the target changes.
      if (!progressed) break;
    }
    if (direct && handTarget) g.target = handTarget;
  }

  step(dt = STEP, pausedHand = false): boolean {
    this.steps++;
    this.contacts.clear();
    const all = this.cords.flatMap(c => c.nodes);
    const g = this.grip;
    const held = g && g.dock === null && (g.index === 0 || g.index === COUNT - 1) ? this.cords[g.cord].nodes[g.index] : null;
    const heldMass = held?.mass ?? 0;
    if(held&&!pausedHand){
      if(this.retryVelocities.length!==all.length*3)this.retryVelocities=new Float64Array(all.length*3);
      all.forEach((p,i)=>{this.retryVelocities[i*3]=p.velocity.x;this.retryVelocities[i*3+1]=p.velocity.y;this.retryVelocities[i*3+2]=p.velocity.z;});
    }
    for (const p of all) {
      Object.assign(p.old, p.p);
      if (!p.mass || p === held) continue;
      p.velocity.y -= SCENE_GRAVITY * dt;
      const speed=Math.sqrt(p.velocity.x**2+p.velocity.y**2+p.velocity.z**2);
      const scale=Math.min(dt,TRAVEL/(speed||1));
      p.p.x+=p.velocity.x*scale;p.p.y+=p.velocity.y*scale;p.p.z+=p.velocity.z*scale;
    }
    const drives=g?[g,...this.docking]:this.docking;
    for (const drive of drives) {
      const p = this.cords[drive.cord].nodes[drive.index];
      const d = sub(drive.target, p.p);
      move(p.p, d, Math.min(drive === g && held ? 1 : drive.dock !== null ? 0.22 : this.feel.grip, TRAVEL / (length(d) || 1)));
      if (drive === g && held) {
        held.p.y = Math.max(held.radius + 0.001, held.p.y);
        held.p.z = Math.max(held.radius + 0.001, held.p.z);
        // The hand is a kinematic boundary condition. Damping and cable mass
        // affect the dangling cable, never the end inside the user's grip.
        held.mass = 0;
      }
      if (drive.dock !== null) {
        const neighbour = this.cords[drive.cord].nodes[drive.index === 0 ? 1 : COUNT - 2];
        const align = sub(add(this.sockets[drive.dock], v(0, 0, 0.22)), neighbour.p);
        move(neighbour.p, align, Math.min(0.22, TRAVEL / (length(align) || 1)));
      }
    }
    const pairs = this.pairs(this.segments());
    const complianceScale = (STEP / dt) ** 2;
    // Tiny collision subdivisions need fewer constraint sweeps. Keep the
    // work per simulated second roughly stable as speed rises, rather than
    // multiplying a full ten-sweep solve by every tiny collision step.
    const iterations=Math.max(3,Math.ceil(6*Math.min(1,dt/STEP)));
    const bendCompliance=10/this.feel.bend**2*complianceScale*(iterations/10);
    const stretchCompliance=(0.0005+this.feel.stretch**2*1.5)*complianceScale;
    const sweep = (iteration: number) => {
      for (const c of this.cords) {
        // Rest curvature gives a little shape memory; high compliance lets loops form.
        for (let i = 0; i < COUNT - 2; i++) this.constrain(c.nodes[i], c.nodes[i + 2], this.feel.shapeMemory ? c.bend[i] : c.rest[i] + c.rest[i + 1], bendCompliance);
        for (let k = 0; k < COUNT - 1; k++) {
          const i = iteration % 2 ? COUNT - 2 - k : k;
          this.constrain(c.nodes[i], c.nodes[i + 1], c.rest[i], stretchCompliance);
        }
      }
      for (const [a, b] of pairs) this.collide(a, b);
      for (const p of all) if (p.mass) {
        const r = p.radius;
        for (const axis of ["y", "z"] as const) if (p.p[axis] < r + 0.001) {
          const support = r + 0.001 - p.p[axis];
          p.p[axis] = r + 0.001;
          const slip = sub(p.p, p.old); slip[axis] = 0;
          const travel = length(slip), limit = support * this.feel.floorFriction;
          if (travel > 1e-9) move(p.p, slip, -Math.min(1, limit * (travel < limit * 1.4 ? 1.4 : 1) / travel));
          this.contacts.add(p);
        }
        p.p.x = clamp(p.p.x, -7 + r, 7 - r);
        p.p.z = Math.min(p.p.z, 8 - r);
        const dx=p.p.x-p.old.x,dy=p.p.y-p.old.y,dz=p.p.z-p.old.z;
        const squared=dx*dx+dy*dy+dz*dz;
        if(squared>TRAVEL*TRAVEL){const scale=TRAVEL/Math.sqrt(squared);p.p.x=p.old.x+dx*scale;p.p.y=p.old.y+dy*scale;p.p.z=p.old.z+dz*scale;}
      }
    };
    for(let iteration=0;iteration<iterations;iteration++)sweep(iteration);
    // A displacement bound smaller than the cord radius plus a final segment
    // barrier prevents a mouse jump (or constraint correction) swapping sides.
    // Reject an unresolved step instead of accepting a topology-changing overlap.
    const contactsClear = () => pairs.every(([a, b]) => closest(a.a.p, a.b.p, b.a.p, b.b.p).distance >= (a.radius + b.radius) * 0.985);
    const lengthsValid = () => {
      if(!held||!g)return true;
      const c=this.cords[g.cord];
      let rest=0,current=0,previous=0;
      for(let i=0;i<c.rest.length;i++){
        rest+=c.rest[i];current+=distance(c.nodes[i].p,c.nodes[i+1].p);previous+=distance(c.nodes[i].old,c.nodes[i+1].old);
      }
      // Distance constraints handle individual links. The hard hand limit is
      // the whole cord's material length, not a transient stretch in one link
      // while tension propagates around a contact and draws on available slack.
      return current<=Math.max(rest*(1.04+this.feel.stretch*0.3),previous+0.00001);
    };
    // A local length violation can mean that tension has not yet propagated
    // around a bend. Spend extra sweeps only on this difficult held step.
    if(held&&!lengthsValid())for(let i=0;i<24;i++){
      sweep(iterations+i);
      if(i%4===3&&lengthsValid()&&contactsClear())break;
    }
    const contactValid = contactsClear();
    const extensionValid = lengthsValid();
    const valid = contactValid && extensionValid;
    if (held) held.mass = heldMass;
    if (!valid) {
      this.rejectedSteps++;
      this.lastRejection = contactValid ? "extension" : "contact";
      all.forEach((p,i)=>{
        Object.assign(p.p,p.old);
        if(held&&!pausedHand){p.velocity.x=this.retryVelocities[i*3];p.velocity.y=this.retryVelocities[i*3+1];p.velocity.z=this.retryVelocities[i*3+2];}
        else{p.velocity.x*=0.25;p.velocity.y*=0.25;p.velocity.z*=0.25;}
      });
      if(held&&!pausedHand&&g){
        // Keep the last safe grip, but let the cable redistribute slack. A
        // rejected hand increment must not freeze every other particle too.
        const target=g.target;g.target={...held.p};
        const progressed=this.step(dt,true);g.target=target;
        return progressed;
      }
      return false;
    }
    this.simulationTime += dt;
    for (const p of all) if (p.mass) {
      p.velocity.x=(p.p.x-p.old.x)/dt;p.velocity.y=(p.p.y-p.old.y)/dt;p.velocity.z=(p.p.z-p.old.z)/dt;
      if (this.contacts.has(p)) {
        if (p.p.y <= p.radius + 0.002) p.velocity.y = Math.max(0, p.velocity.y);
        if (p.p.z <= p.radius + 0.002) p.velocity.z = Math.max(0, p.velocity.z);
      }
    }
    // Material damping removes relative motion inside the cable. It must not
    // act like syrup/air drag on a cable in free fall: uniform Earth-gravity
    // acceleration is unchanged, regardless of the damping slider.
    const damping = 1 - Math.exp(-this.feel.damping * dt * 6);
    for (const c of this.cords) dampCableModes(c.nodes, this.feel.settling, dt, held);
    for (const c of this.cords) for (let i = 0; i < COUNT - 1; i++) {
      const a = c.nodes[i], b = c.nodes[i + 1];
      const wa = a === held ? 0 : a.mass, wb = b === held ? 0 : b.mass;
      if (wa + wb === 0) continue;
      const scale=damping/(wa+wb);
      const x=(b.velocity.x-a.velocity.x)*scale,y=(b.velocity.y-a.velocity.y)*scale,z=(b.velocity.z-a.velocity.z)*scale;
      a.velocity.x+=x*wa;a.velocity.y+=y*wa;a.velocity.z+=z*wa;
      b.velocity.x-=x*wb;b.velocity.y-=y*wb;b.velocity.z-=z*wb;
    }
    for (const dock of [...this.docking]) this.finishDock(dock);
    return true;
  }

  private finishDock(g: Grip) {
    const c = this.cords[g.cord], p = c.nodes[g.index], port = this.sockets[g.dock!];
    const neighbour = c.nodes[g.index === 0 ? 1 : COUNT - 2];
    // Align the strain relief by a bounded physical pull before seating.
    const wanted = add(port, v(0, 0, 0.22));
    if (distance(p.p, port) > 0.025 || distance(neighbour.p, wanted) > 0.035) return;
    // A newly inserted metal shaft must also have clearance all the way to
    // the panel; checking only the visible plug would seal a cord behind it.
    const base = v(p.p.x, p.p.y, 0);
    for (const s of this.segments()) {
      if (s.cord === g.cord && (g.index === 0 ? s.index <= 3 : s.index >= COUNT - 5)) continue;
      if (closest(base, p.p, s.a.p, s.b.p).distance < PLUG_RADIUS + s.radius + 0.001) return;
    }
    // Lock at the reached position: no snap through nearby geometry.
    c.ports[g.index === 0 ? 0 : 1] = g.dock;
    p.mass = 0; neighbour.mass = 0;
    p.velocity = v(); neighbour.velocity = v();
    this.docking = this.docking.filter(d => d !== g);
  }

  diagnostics() {
    let penetration = 0, stretch = 1;
    for (const [a, b] of this.pairs(this.segments())) penetration = Math.max(penetration, a.radius + b.radius - closest(a.a.p, a.b.p, b.a.p, b.b.p).distance);
    for (const c of this.cords) c.rest.forEach((r, i) => { stretch = Math.max(stretch, distance(c.nodes[i].p, c.nodes[i + 1].p) / r); });
    return { penetration, stretch, rejectedSteps: this.rejectedSteps, lastRejection: this.lastRejection, steps: this.steps, simulationTime: this.simulationTime, metersPerUnit: METERS_PER_UNIT, docking: this.docking.map(d => ({ cord: d.cord, index: d.index, port: d.dock })), feel: { ...this.feel }, finite: this.cords.every(c => c.nodes.every(n => Number.isFinite(dot(n.p, n.p)))) };
  }
}
