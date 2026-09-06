import { add, clamp, closest, distance, dot, length, lerp, move, mul, sub, unit, v, type V3 } from "./math";
import { DEFAULT_FEEL, sanitizeFeel, type CableFeel } from "./settings";
import { CABLE_COLORS, CABLE_LENGTHS, seededRandom, type SocketLayout } from "./layout";

export const RADIUS = 0.065;
export const STEP = 1 / 600;
export const EARTH_GRAVITY = 9.81;
// One scene unit is 5 cm: the 0.13-unit cable is 6.5 mm thick and the
// 7.55-unit board is about 38 cm high, rather than a 7.55-metre wall.
export const METERS_PER_UNIT = 0.05;
const SCENE_GRAVITY = EARTH_GRAVITY / METERS_PER_UNIT;
export const PLUG_RADIUS = 0.125;
const COUNT = 73;
const TRAVEL = RADIUS * 0.42;
export type Particle = { p: V3; old: V3; velocity: V3; mass: number; radius: number };
export type Cord = { color: number[]; nodes: Particle[]; rest: number[]; bend: number[]; ports: [number | null, number | null]; stockLength?: number };
export type Grip = { cord: number; index: number; target: V3; dock: number | null };
type Segment = { a: Particle; b: Particle; cord: number; index: number; radius: number; min: V3; max: V3 };
type RestState = { sleeping: boolean; probe: V3[]; quietTime: number; idleTime: number; ports: string };

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

// Remove short-wavelength velocity ripples, not the hand's motion. Pairwise
// impulses preserve momentum and barely affect a broad, smooth cable swing.
export function dampCableRipples(nodes: Particle[], dt: number, held: Particle | null = null) {
  const amount=1-Math.exp(-80*dt);
  for(let parity=0;parity<2;parity++)for(let i=parity;i<nodes.length-1;i+=2){
    const a=nodes[i],b=nodes[i+1];
    if(!a.mass||!b.mass||a===held||b===held)continue;
    const scale=amount/(a.mass+b.mass);
    const x=(b.velocity.x-a.velocity.x)*scale,y=(b.velocity.y-a.velocity.y)*scale,z=(b.velocity.z-a.velocity.z)*scale;
    a.velocity.x+=x*a.mass;a.velocity.y+=y*a.mass;a.velocity.z+=z*a.mass;
    b.velocity.x-=x*b.mass;b.velocity.y-=y*b.mass;b.velocity.z-=z*b.mass;
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
  private restStates = new Map<Cord, RestState>();
  private restGroups: Cord[][] = [];
  private supportContacts = new Map<Cord,Set<Cord>>();
  private restingSegments = new Map<Cord,Segment[]>();
  private restingBroadphase: { segments: Segment[]; pairs: [Segment,Segment][]; maxX: number[] } | null = null;
  private sleepingNodes = new Set<Particle>();
  private memoryTime = 0;
  private handTarget: V3 | null = null;
  private handStillTime = 0;
  private advancing = false;
  private initial: { seed: number; cables: number } | undefined;
  get sleeping() { return this.cords.length > 0 && this.cords.every(c => this.isResting(c)); }
  isResting(c: Cord) { return this.sleepingNodes.has(c.nodes[0]); }

  private restState(c: Cord): RestState {
    let state=this.restStates.get(c);
    if(!state){state={sleeping:false,probe:[],quietTime:0,idleTime:0,ports:c.ports.join(",")};this.restStates.set(c,state);}
    return state;
  }

  private wake(cord?: Cord) {
    const pending=cord?[cord]:[...this.cords],seen=new Set<Cord>();
    for(let i=0;i<pending.length;i++){
      const c=pending[i];if(seen.has(c))continue;seen.add(c);
      const s=this.restState(c);
      if(s.sleeping){
        this.restingSegments.delete(c);
        for(const n of c.nodes)this.sleepingNodes.delete(n);
      }
      s.sleeping=false;s.quietTime=0;s.idleTime=0;s.probe.length=0;
      // Only loose dependents can lose their support when this cable moves.
      // Socketed/floor-supported neighbors wait for an actual contact push;
      // mere membership in a touching chain is not a reason to animate them.
      for(const other of this.supportContacts.get(c)??[])if(!this.hasSupport(other))pending.push(other);
    }
  }

  private hasSupport(c: Cord) {
    return c.ports.some(p=>p!==null)||c.nodes.some(n=>n.p.y<=n.radius+0.004||(this.feel.floorFriction>0&&n.p.z<=n.radius+0.004))||
      (this.grip!==null&&this.cords[this.grip.cord]===c)||this.docking.some(d=>this.cords[d.cord]===c);
  }

  private trackHand(dt:number) {
    if(!this.grip){this.handTarget=null;this.handStillTime=0;return;}
    if(!this.handTarget||distance(this.grip.target,this.handTarget)>1e-7){
      this.handTarget={...this.grip.target};this.handStillTime=0;
      this.wake(this.cords[this.grip.cord]);
    }else this.handStillTime+=dt;
  }

  private wakeExternalChanges() {
    for(const c of this.cords)if(this.isResting(c)&&(this.restState(c).ports!==c.ports.join(",")||c.nodes.some(n=>n.velocity.x!==0||n.velocity.y!==0||n.velocity.z!==0||n.p.x!==n.old.x||n.p.y!==n.old.y||n.p.z!==n.old.z)))this.wake(c);
  }

  private sleep(c: Cord) {
    const s=this.restState(c);s.sleeping=true;s.ports=c.ports.join(",");
    for(const n of c.nodes){n.velocity=v();Object.assign(n.old,n.p);this.sleepingNodes.add(n);}
  }

  restInitialPlacement() {
    // Only a fresh, fully plugged-in placement may begin asleep. This is
    // initialization, never a way to freeze a handled or falling cable.
    if(this.steps!==0||this.grip||this.docking.length||!this.cords.length||this.cords.some(c=>c.ports.includes(null)))return false;
    const pairs=this.pairs(this.segments());
    if(pairs.some(([a,b])=>closest(a.a.p,a.b.p,b.a.p,b.b.p).distance<(a.radius+b.radius)*0.985))return false;
    this.settle(0,pairs);
    for(const c of this.cords)this.sleep(c);
    return true;
  }

  private settle(dt: number, pairs: [Segment, Segment][]) {
    // Support propagates across real cord/plug contacts, not through the
    // panel or through the mere existence of another cable in the scene.
    const roots=this.cords.map((_,i)=>i);
    const root=(i:number):number=>roots[i]===i?i:(roots[i]=root(roots[i]));
    const contacts=new Map<Cord,Set<Cord>>();
    for(const [a,b] of pairs)if(a.cord!==b.cord){
      const ca=this.cords[a.cord],cb=this.cords[b.cord];
      const touching=this.isResting(ca)&&this.isResting(cb)?this.supportContacts.get(ca)?.has(cb):closest(a.a.p,a.b.p,b.a.p,b.b.p).distance<=a.radius+b.radius+0.006;
      if(!touching)continue;
      roots[root(a.cord)]=root(b.cord);
      if(!contacts.has(ca))contacts.set(ca,new Set());if(!contacts.has(cb))contacts.set(cb,new Set());
      contacts.get(ca)!.add(cb);contacts.get(cb)!.add(ca);
    }
    this.supportContacts=contacts;
    const groups=new Map<number,Cord[]>();
    this.cords.forEach((c,i)=>{const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r)!.push(c);});
    this.restGroups=[...groups.values()];
    for(const group of this.restGroups){
      const supported=group.some(c=>this.hasSupport(c));
      for(const c of group){
        const driven=this.grip!==null&&this.cords[this.grip.cord]===c&&this.handStillTime<0.18;
        if(driven||!supported){this.wake(c);continue;}
        const s=this.restState(c);if(s.sleeping)continue;
        const idle=s.idleTime+dt;
        const drift=s.probe.length!==c.nodes.length||c.nodes.some((n,i)=>distance(n.p,s.probe[i])>0.035);
        const quiet=drift?0:s.quietTime+dt;
        s.idleTime=idle;s.quietTime=quiet;
        if(drift)s.probe=c.nodes.map(n=>({...n.p}));
        // Once supported and left alone, dissipate the residual whole-cable
        // swing too. Pure mode damping preserves this motion indefinitely.
        // Unsupported free fall and a moving hand are never damped here.
        // A stationary hand provides support just like a stationary socket.
        const retain=Math.exp(-Math.min(4,Math.max(0,idle-1.25)*2)*dt);
        for(const n of c.nodes)if(n.mass){n.velocity.x*=retain;n.velocity.y*=retain;n.velocity.z*=retain;}
        if(quiet>=0.65)this.sleep(c);
      }
    }
  }

  constructor(layout?: SocketLayout, initial?: { seed: number; cables: number }) {
    this.initial=initial;
    if(layout)this.sockets=Array.from({length:layout.columns*layout.rows},(_,i)=>v((i%layout.columns-(layout.columns-1)/2)*layout.gap,layout.top-Math.floor(i/layout.columns)*(layout.rowGap??layout.gap),0.3));
    this.reset();
  }

  configure(settings: CableFeel) {
    this.wake();
    this.feel = sanitizeFeel(settings);
    for (const c of this.cords) for (const i of [0, c.nodes.length - 1]) {
      if (c.nodes[i].mass) c.nodes[i].mass = 1 / this.feel.plugWeight;
    }
  }

  reset() {
    this.wake();
    this.restStates.clear();this.restGroups=[];this.sleepingNodes.clear();this.supportContacts.clear();this.restingSegments.clear();
    this.restingBroadphase=null;
    this.grip = null;
    this.handTarget=null;this.handStillTime=0;
    this.docking = [];
    this.rejectedSteps = 0;
    this.steps = 0;
    this.simulationTime = 0;
    this.lastRejection = null;
    if(this.initial){this.randomPatch(this.initial.seed,this.initial.cables);return;}
    this.cords = [[0, 2], [3, 5], [7, 9]].map(([a, b], ci) => this.makeCord(a,b,3.8,0.55,ci));
  }

  private makeCord(a: number, b: number, sag: number, depth: number, ci: number, stockLength?: number): Cord {
      const count=stockLength?Math.max(25,Math.round((stockLength-0.44)/0.115)+3):COUNT;
      const start = this.sockets[a], end = this.sockets[b];
      const curve = Array.from({ length: 501 }, (_, i) => {
        const t = i / 500, p = lerp(start, end, t);
        p.y -= sag * Math.sin(Math.PI * t);
        p.z += 0.22 + depth * Math.sin(Math.PI * t);
        return p;
      });
      const arc = [0];
      for (let i = 1; i < curve.length; i++) arc.push(arc[i - 1] + distance(curve[i - 1], curve[i]));
      const nodes = Array.from({ length: count }, (_, i): Particle => {
        const target = clamp((i - 1) / (count - 3), 0, 1) * arc[500];
        let j = 1;
        while (j < 500 && arc[j] < target) j++;
        const p = i === 0 ? { ...start } : i === count - 1 ? { ...end } : lerp(curve[j - 1], curve[j], (target - arc[j - 1]) / (arc[j] - arc[j - 1]));
        return { p, old: { ...p }, velocity: v(), mass: i < 2 || i > count - 3 ? 0 : 1, radius: i < 2 || i > count - 3 ? PLUG_RADIUS : RADIUS };
      });
      const rest=nodes.slice(1).map((n,i)=>stockLength?(i===0||i===count-2?0.22:(stockLength-0.44)/(count-3)):distance(nodes[i].p,n.p));
      return {
        nodes, color: [...CABLE_COLORS[ci%CABLE_COLORS.length]], rest, stockLength,
        // A cable's manufacture gives it a gentle, distributed coil set, not
        // a copy of the exact hanging initialization pose. Small deterministic
        // differences distinguish cords without introducing random kinks.
        bend: nodes.slice(2).map((_,i)=>{
          const turn=0.045+0.009*Math.sin(i/(count-3)*Math.PI*2+ci*1.7);
          return Math.sqrt(rest[i]**2+rest[i+1]**2+2*rest[i]*rest[i+1]*Math.cos(turn));
        }),
        ports: [a, b] as [number, number],
      };
  }

  private randomPatch(seed: number, wanted: number) {
    const random=seededRandom(seed),used=new Set<number>();
    this.cords=[];
    const shuffled=Array.from({length:this.sockets.length},(_,i)=>i);
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    // Try spatially shuffled starts, not a shared top row. Whole capsules and
    // inserted shafts are checked before accepting any initial cable.
    for(let attempt=0;attempt<1800&&this.cords.length<wanted;attempt++){
      // A short landscape board may have no safe remaining pair for a long
      // cable. Try another stock size instead of leaving the set half empty.
      const ci=this.cords.length,stockLength=CABLE_LENGTHS[(ci+Math.floor(attempt/300))%CABLE_LENGTHS.length];
      const a=shuffled[attempt%shuffled.length],b=Math.floor(random()*this.sockets.length);
      if(a===b||used.has(a)||used.has(b))continue;
      const start=this.sockets[a],end=this.sockets[b];
      if(distance(start,end)>stockLength-0.8)continue;
      const depth=0.2+random()*0.85;
      const arcLength=(sag:number)=>{
        let total=0,previous=add(start,v(0,0,0.22));
        for(let i=1;i<=80;i++){
          const t=i/80,p=lerp(start,end,t),s=Math.sin(Math.PI*t);p.y-=sag*s;p.z+=0.22+depth*s;
          total+=distance(previous,p);previous=p;
        }
        return total;
      };
      if(arcLength(0)>stockLength-0.44)continue;
      let lo=0,hi=stockLength/2;
      for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(arcLength(mid)<stockLength-0.44)lo=mid;else hi=mid;}
      const c=this.makeCord(a,b,(lo+hi)/2,depth,Math.floor(random()*CABLE_COLORS.length),stockLength);
      if(c.nodes.some(n=>n.p.y<n.radius+0.08))continue;
      this.cords.push(c);
      const index=this.cords.length-1;
      const clear=this.pairs(this.segments()).every(([x,y])=>(x.cord!==index&&y.cord!==index)||closest(x.a.p,x.b.p,y.a.p,y.b.p).distance>x.radius+y.radius+0.035);
      if(!clear){this.cords.pop();this.restStates.delete(c);continue;}
      used.add(a);used.add(b);
    }
  }

  occupied(port: number) { return this.cords.some(c => c.ports.includes(port)) || this.docking.some(d => d.dock === port); }
  dockingBlocked(dock: Grip) { return this.restState(this.cords[dock.cord]).sleeping; }

  cancelDocking() { this.docking = []; this.wake(); }

  grab(cord: number, index: number) {
    this.wake(this.cords[cord]);
    // A blocked, sleeping insertion may become possible as another plug is
    // removed, even when only its prospective metal shaft was obstructed.
    for(const dock of this.docking)this.wake(this.cords[dock.cord]);
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
    this.handTarget=null;this.handStillTime=0;
  }

  release(port: number | null = null, approach = false) {
    const g = this.grip;
    if(g)this.wake(this.cords[g.cord]);
    this.handTarget=null;this.handStillTime=0;
    if (g && port !== null && !this.occupied(port) && (g.index === 0 || g.index === this.cords[g.cord].nodes.length - 1)) {
      // Dock by pulling to the socket. Never teleport an end on mouse-up.
      // The raised-hand approach is requested only after the view verifies
      // that both the cursor and the actual held tip are over the aperture.
      const p = this.cords[g.cord].nodes[g.index].p;
      // A dropped plug can lie farther out on the table than the usual hand
      // plane. A verified approach must work from that depth too; the solver
      // still checks the complete path, cable reach and final insertion.
      if (approach || distance(p, this.sockets[port]) < 0.65) {
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
      const cached=this.restingSegments.get(c);
      if(this.isResting(c)&&cached?.[0]?.cord===ci){segments.push(...cached);return;}
      const first=segments.length;
      for (let i = 0; i < c.nodes.length - 1; i++) {
        const a = c.nodes[i], b = c.nodes[i + 1], r = Math.max(a.radius, b.radius);
        segments.push({ a, b, cord: ci, index: i, radius: r,
          min: v(Math.min(a.p.x, b.p.x) - r - TRAVEL * 2, Math.min(a.p.y, b.p.y) - r - TRAVEL * 2, Math.min(a.p.z, b.p.z) - r - TRAVEL * 2),
          max: v(Math.max(a.p.x, b.p.x) + r + TRAVEL * 2, Math.max(a.p.y, b.p.y) + r + TRAVEL * 2, Math.max(a.p.z, b.p.z) + r + TRAVEL * 2) });
      }
      c.ports.forEach((port, end) => {
        if (port === null) return;
        const b = c.nodes[end === 0 ? 0 : c.nodes.length - 1];
        const p = v(b.p.x, b.p.y, 0);
        const a: Particle = { p, old: { ...p }, velocity: v(), mass: 0, radius: PLUG_RADIUS };
        segments.push({ a, b, cord: ci, index: end === 0 ? -1 : c.nodes.length - 1, radius: PLUG_RADIUS,
          min: v(p.x - PLUG_RADIUS - TRAVEL * 2, p.y - PLUG_RADIUS - TRAVEL * 2, -PLUG_RADIUS),
          max: v(p.x + PLUG_RADIUS + TRAVEL * 2, p.y + PLUG_RADIUS + TRAVEL * 2, b.p.z + PLUG_RADIUS + TRAVEL * 2) });
      });
      if(this.isResting(c))this.restingSegments.set(c,segments.slice(first));
    });
    return segments.sort((a, b) => a.min.x - b.min.x);
  }

  private pairs(segments: Segment[]) {
    const overlaps=(a:Segment,b:Segment)=>{
      // Local neighbours share a continuous bend, not a collision surface.
      return !(a.cord===b.cord&&Math.abs(a.index-b.index)<=3)&&
        a.max.y>=b.min.y&&b.max.y>=a.min.y&&a.max.z>=b.min.z&&b.max.z>=a.min.z;
    };
    const sweep=(list:Segment[])=>{
      const pairs:[Segment,Segment][]=[];
      for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
        const a=list[i],b=list[j];if(b.min.x>a.max.x)break;
        if(overlaps(a,b))pairs.push([a,b]);
      }
      return pairs;
    };
    const sleeping=this.cords.map(c=>this.isResting(c)),still:Segment[]=[],moving:Segment[]=[];
    for(const s of segments)(sleeping[s.cord]?still:moving).push(s);
    if(!still.length)return sweep(moving);
    let cached=this.restingBroadphase;
    if(!cached||cached.segments.length!==still.length||still.some((s,i)=>s!==cached!.segments[i])){
      let max=-Infinity;
      cached={segments:still,pairs:sweep(still),maxX:still.map(s=>(max=Math.max(max,s.max.x)))};
      this.restingBroadphase=cached;
    }
    // Resting/resting candidates remain in the result: a cable can wake
    // during a constraint sweep, and must immediately collide with neighbors.
    // Only their broad-phase search is cached, never collision participation.
    const pairs:[Segment,Segment][]=[...cached.pairs,...sweep(moving)];
    for(const a of moving){
      // Prefix maxima safely exclude every static interval ending to the
      // left, including long/slanted capsules; this is not a point shortcut.
      let lo=0,hi=still.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(cached.maxX[mid]<a.min.x)lo=mid+1;else hi=mid;}
      for(let i=lo;i<still.length&&still[i].min.x<=a.max.x;i++){
        const b=still[i];if(b.max.x<a.min.x||!overlaps(a,b))continue;
        pairs.push(a.min.x<=b.min.x?[a,b]:[b,a]);
      }
    }
    pairs.sort((a,b)=>a[0].min.x-b[0].min.x||a[1].min.x-b[1].min.x);
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

  private smoothBend(a: Particle, b: Particle, c: Particle, compliance: number) {
    let ux=a.p.x-b.p.x,uy=a.p.y-b.p.y,uz=a.p.z-b.p.z;
    let vx=c.p.x-b.p.x,vy=c.p.y-b.p.y,vz=c.p.z-b.p.z;
    const la=Math.sqrt(ux*ux+uy*uy+uz*uz),lc=Math.sqrt(vx*vx+vy*vy+vz*vz);
    if(la<1e-6||lc<1e-6)return;
    ux/=la;uy/=la;uz/=la;vx/=lc;vy/=lc;vz/=lc;
    const q=clamp(ux*vx+uy*vy+uz*vz,-1,1);
    if(q<-0.9838436928)return;
    const turn=Math.acos(-q);
    const sin=Math.sqrt(Math.max(1e-8,1-q*q));
    const ax=(vx-q*ux)/(la*sin),ay=(vy-q*uy)/(la*sin),az=(vz-q*uz)/(la*sin);
    const cx=(ux-q*vx)/(lc*sin),cy=(uy-q*vy)/(lc*sin),cz=(uz-q*vz)/(lc*sin);
    const bx=-ax-cx,by=-ay-cy,bz=-az-cz;
    const denom=a.mass*(ax*ax+ay*ay+az*az)+b.mass*(bx*bx+by*by+bz*bz)+c.mass*(cx*cx+cy*cy+cz*cz)+compliance;
    if(!denom)return;
    const correction=-(turn-0.18)/denom;
    const wa=a.mass*correction,wb=b.mass*correction,wc=c.mass*correction;
    a.p.x+=ax*wa;a.p.y+=ay*wa;a.p.z+=az*wa;
    b.p.x+=bx*wb;b.p.y+=by*wb;b.p.z+=bz*wb;
    c.p.x+=cx*wc;c.p.y+=cy*wc;c.p.z+=cz*wc;
  }

  private rememberBends(dt: number) {
    if(!this.feel.shapeMemory||!this.grip){this.memoryTime=0;return;}
    this.memoryTime+=dt;if(this.memoryTime<0.05)return;
    const c=this.cords[this.grip.cord],turns=c.bend.map((_,i)=>{
      const a=sub(c.nodes[i+1].p,c.nodes[i].p),b=sub(c.nodes[i+2].p,c.nodes[i+1].p);
      return Math.acos(clamp(dot(a,b)/(length(a)*length(b)||1),-1,1));
    });
    // Slow material creep only while handled. Average over a broad section;
    // a brief sharp contact must not become a permanent notch.
    const rate=1-Math.exp(-this.memoryTime/30);this.memoryTime=0;
    for(let i=3;i<c.bend.length-3;i++){
      let turn=0;for(let j=i-3;j<=i+3;j++)turn+=turns[j]/7;
      turn=clamp(turn,0.025,0.12);
      const a=c.rest[i],b=c.rest[i+1],wanted=Math.sqrt(a*a+b*b+2*a*b*Math.cos(turn));
      c.bend[i]+=(wanted-c.bend[i])*rate;
    }
  }

  private collide(a: Segment, b: Segment) {
    const ca=this.cords[a.cord],cb=this.cords[b.cord];
    let asleepA=this.isResting(ca),asleepB=this.isResting(cb);
    if(asleepA&&asleepB)return;
    const c = closest(a.a.p, a.b.p, b.a.p, b.b.p);
    const gap = a.radius + b.radius + 0.0015 - c.distance;
    if (gap <= 0) return;
    if(asleepA||asleepB){
      const oldDistance=closest(a.a.old,a.b.old,b.a.old,b.b.old).distance;
      // A resting cable is a static collision surface until a meaningful
      // push reaches it. Constraint bias and tiny residual waves must not
      // restart a whole network of otherwise settled, socketed cables.
      // The held cord can press a neighbor even at very low mouse speed.
      const handContact=this.grip!==null&&(a.cord===this.grip.cord||b.cord===this.grip.cord);
      const pushed=oldDistance-c.distance>0.004||gap>0.006||(handContact&&gap>0.0015);
      if(asleepA&&pushed&&(a.a.mass*(1-c.s)+a.b.mass*c.s)>0){this.wake(ca);asleepA=false;}
      if(asleepB&&pushed&&(b.a.mass*(1-c.t)+b.b.mass*c.t)>0){this.wake(cb);asleepB=false;}
    }
    const n = c.distance > 1e-8 ? mul(sub(c.p, c.q), 1 / c.distance) : unit(sub(lerp(a.a.old, a.b.old, c.s), lerp(b.a.old, b.b.old, c.t)));
    const weights = [1 - c.s, c.s, 1 - c.t, c.t];
    const nodes = [a.a, a.b, b.a, b.b];
    const masses=nodes.map((p,i)=>(i<2?asleepA:asleepB)?0:p.mass);
    const inv = nodes.reduce((sum, _, i) => sum + masses[i] * weights[i] ** 2, 0);
    if (!inv) return;
    nodes.forEach((p, i) => {
      move(p.p, n, (i < 2 ? 1 : -1) * masses[i] * weights[i] * gap / inv);
      if (masses[i]) this.contacts.add(p);
    });
    // Tangential contact friction transfers motion between cables instead of
    // merely damping each cable independently. Small slips stick statically.
    const slip = sub(sub(c.p, lerp(a.a.old, a.b.old, c.s)), sub(c.q, lerp(b.a.old, b.b.old, c.t)));
    const tangent = sub(slip, mul(n, dot(slip, n))), travel = length(tangent);
    if (travel > 1e-9) {
      const limit = this.feel.cordFriction * gap;
      const amount = travel <= limit * 1.4 ? travel : Math.min(travel, limit);
      nodes.forEach((p, i) => move(p.p, tangent, (i < 2 ? -1 : 1) * masses[i] * weights[i] * amount / (inv * travel)));
    }
  }

  advance(duration: number) {
    // Observe the actual mouse target once per display frame, before the
    // collision-safe interpolation below. Interpolated substeps are not input.
    this.trackHand(duration);
    this.wakeExternalChanges();
    this.advancing=true;
    // Resolve the entire hand path within this display frame. Extra collision
    // subdivisions share the same elapsed time; fast dragging doesn't speed
    // up gravity and doesn't impose a fixed units-per-second hand speed.
    const g = this.grip;
    const direct = g && g.dock === null && (g.index === 0 || g.index === this.cords[g.cord].nodes.length - 1);
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
      if (!progressed) {
        // A rejected collision step can still be a quiet, supported state.
        // Rest timers follow elapsed time, not only accepted solver substeps.
        if(!g||this.handStillTime>=0.18)this.settle(Math.max(0,duration-(i+1)*dt),this.pairs(this.segments()));
        break;
      }
    }
    if (direct && handTarget) g.target = handTarget;
    this.advancing=false;
  }

  step(dt = STEP, pausedHand = false): boolean {
    this.steps++;
    if(!this.advancing&&!pausedHand){this.trackHand(dt);this.wakeExternalChanges();}
    if(this.sleeping){
      if(this.grip&&this.handStillTime<0.18)this.wake(this.cords[this.grip.cord]);
      else{this.simulationTime+=dt;return true;}
    }
    this.contacts.clear();
    const all = this.cords.flatMap(c => c.nodes);
    const g = this.grip;
    const held = g && g.dock === null && (g.index === 0 || g.index === this.cords[g.cord].nodes.length - 1) ? this.cords[g.cord].nodes[g.index] : null;
    const heldMass = held?.mass ?? 0;
    const dockPins=new Map<Particle,number>();
    for(const dock of this.docking)if(!this.restState(this.cords[dock.cord]).sleeping){
      const c=this.cords[dock.cord];
      for(const i of [dock.index,dock.index===0?1:c.nodes.length-2])dockPins.set(c.nodes[i],c.nodes[i].mass);
    }
    if(held&&!pausedHand){
      if(this.retryVelocities.length!==all.length*3)this.retryVelocities=new Float64Array(all.length*3);
      all.forEach((p,i)=>{this.retryVelocities[i*3]=p.velocity.x;this.retryVelocities[i*3+1]=p.velocity.y;this.retryVelocities[i*3+2]=p.velocity.z;});
    }
    for (const p of all) {
      if(this.sleepingNodes.has(p))continue;
      Object.assign(p.old, p.p);
      if (!p.mass || p === held || dockPins.has(p)) continue;
      p.velocity.y -= SCENE_GRAVITY * dt;
      const speed=Math.sqrt(p.velocity.x**2+p.velocity.y**2+p.velocity.z**2);
      const scale=Math.min(dt,TRAVEL/(speed||1));
      p.p.x+=p.velocity.x*scale;p.p.y+=p.velocity.y*scale;p.p.z+=p.velocity.z*scale;
    }
    const drives=g?[g,...this.docking]:this.docking;
    for (const drive of drives) {
      if(this.restState(this.cords[drive.cord]).sleeping)continue;
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
        const neighbour = this.cords[drive.cord].nodes[drive.index === 0 ? 1 : this.cords[drive.cord].nodes.length - 2];
        const align = sub(add(this.sockets[drive.dock], v(0, 0, 0.22)), neighbour.p);
        move(neighbour.p, align, Math.min(0.22, TRAVEL / (length(align) || 1)));
        // Alignment is a bounded placement of the rigid connector, not a
        // soft spring that cable tension can hold permanently half-seated.
        // Collision validation below can still reject either placement.
        p.mass=0;neighbour.mass=0;
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
        if(this.restState(c).sleeping)continue;
        const count=c.nodes.length;
        // Rest curvature gives a little shape memory; high compliance lets loops form.
        for (let k = 0; k < count - 2; k++) {
          const i=iteration%2?count-3-k:k;
          this.constrain(c.nodes[i], c.nodes[i + 2], this.feel.shapeMemory ? c.bend[i] : c.rest[i] + c.rest[i + 1], bendCompliance);
          // Angle-based resistance distributes curvature where the distance
          // bend constraint is poorly conditioned near a straight segment.
          if(i>1&&i<count-4)this.smoothBend(c.nodes[i],c.nodes[i+1],c.nodes[i+2],bendCompliance*80);
        }
        for (let k = 0; k < count - 1; k++) {
          const i = iteration % 2 ? count - 2 - k : k;
          this.constrain(c.nodes[i], c.nodes[i + 1], c.rest[i], stretchCompliance);
        }
      }
      for (const [a, b] of pairs) this.collide(a, b);
      for (const p of all) if (p.mass&&!this.sleepingNodes.has(p)) {
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
    const contactsClear = () => pairs.every(([a, b]) => (this.isResting(this.cords[a.cord])&&this.isResting(this.cords[b.cord]))||closest(a.a.p, a.b.p, b.a.p, b.b.p).distance >= (a.radius + b.radius) * 0.985);
    const lengthDriven=new Set(this.docking.filter(d=>!this.dockingBlocked(d)).map(d=>this.cords[d.cord]));
    if(held&&g)lengthDriven.add(this.cords[g.cord]);
    const lengthsValid = () => {
      // Distance constraints handle individual links. The hard hand limit is
      // the whole cord's material length, not a transient stretch in one link
      // while tension propagates around a contact and draws on available slack.
      // Docking must respect the same limit; insertion cannot stretch a trapped
      // cable beyond the reach that was available in the user's hand.
      for(const c of lengthDriven){
        let rest=0,current=0,previous=0;
        for(let i=0;i<c.rest.length;i++){
          rest+=c.rest[i];current+=distance(c.nodes[i].p,c.nodes[i+1].p);previous+=distance(c.nodes[i].old,c.nodes[i+1].old);
        }
        if(current>Math.max(rest*(1.04+this.feel.stretch*0.3),previous+0.00001))return false;
      }
      return true;
    };
    // A local length violation can mean that tension has not yet propagated
    // around a bend. Spend extra sweeps only on this difficult held step.
    if(lengthDriven.size&&!lengthsValid())for(let i=0;i<24;i++){
      sweep(iterations+i);
      if(i%4===3&&lengthsValid()&&contactsClear())break;
    }
    const contactValid = contactsClear();
    const extensionValid = lengthsValid();
    const valid = contactValid && extensionValid;
    if (held) held.mass = heldMass;
    for(const [p,mass] of dockPins)p.mass=mass;
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
      this.settle(dt,pairs);
      return false;
    }
    this.simulationTime += dt;
    for (const p of all) if (p.mass&&!this.sleepingNodes.has(p)) {
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
    for (const c of this.cords) if(!this.restState(c).sleeping)dampCableModes(c.nodes, Math.max(this.grip ? 0 : 3, this.feel.settling), dt, held);
    for (const c of this.cords) if(!this.restState(c).sleeping)for (let i = 0; i < c.nodes.length - 1; i++) {
      const a = c.nodes[i], b = c.nodes[i + 1];
      const wa = a === held ? 0 : a.mass, wb = b === held ? 0 : b.mass;
      if (wa + wb === 0) continue;
      const scale=damping/(wa+wb);
      const x=(b.velocity.x-a.velocity.x)*scale,y=(b.velocity.y-a.velocity.y)*scale,z=(b.velocity.z-a.velocity.z)*scale;
      a.velocity.x+=x*wa;a.velocity.y+=y*wa;a.velocity.z+=z*wa;
      b.velocity.x-=x*wb;b.velocity.y-=y*wb;b.velocity.z-=z*wb;
    }
    if(g&&!this.restState(this.cords[g.cord]).sleeping)dampCableRipples(this.cords[g.cord].nodes,dt,held);
    for (const dock of [...this.docking]) if(!this.restState(this.cords[dock.cord]).sleeping)this.finishDock(dock);
    this.rememberBends(dt);
    this.settle(dt,pairs);
    return true;
  }

  private finishDock(g: Grip) {
    const c = this.cords[g.cord], p = c.nodes[g.index], port = this.sockets[g.dock!];
    const neighbour = c.nodes[g.index === 0 ? 1 : c.nodes.length - 2];
    // Align the strain relief by a bounded physical pull before seating.
    const wanted = add(port, v(0, 0, 0.22));
    if (distance(p.p, port) > 0.025 || distance(neighbour.p, wanted) > 0.035) return;
    if (distance(p.old, port) > TRAVEL || distance(neighbour.old,wanted)>TRAVEL) return;
    // Finish the last sub-radius alignment at the socket center, not at an
    // arbitrary point within the docking tolerance. Validate the corrected
    // geometry before locking; an obstructed insertion stays pending.
    const reached = { ...p.p };
    const reachedNeighbour={...neighbour.p};
    p.p = { ...port };
    neighbour.p={...wanted};
    const segments = this.segments();
    if (this.pairs(segments).some(([a, b]) => closest(a.a.p, a.b.p, b.a.p, b.b.p).distance < (a.radius + b.radius) * 0.985)) {
      p.p = reached;neighbour.p=reachedNeighbour; return;
    }
    // A newly inserted metal shaft must also have clearance all the way to
    // the panel; checking only the visible plug would seal a cord behind it.
    const base = v(p.p.x, p.p.y, 0);
    for (const s of segments) {
      if (s.cord === g.cord && (g.index === 0 ? s.index <= 3 : s.index >= c.nodes.length - 5)) continue;
      if (closest(base, p.p, s.a.p, s.b.p).distance < PLUG_RADIUS + s.radius + 0.001) { p.p = reached;neighbour.p=reachedNeighbour; return; }
    }
    // Lock only the centered, collision-checked insertion.
    c.ports[g.index === 0 ? 0 : 1] = g.dock;
    p.mass = 0; neighbour.mass = 0;
    p.velocity = v(); neighbour.velocity = v();
    this.docking = this.docking.filter(d => d !== g);
  }

  diagnostics() {
    let penetration = 0, stretch = 1;
    for (const [a, b] of this.pairs(this.segments())) penetration = Math.max(penetration, a.radius + b.radius - closest(a.a.p, a.b.p, b.a.p, b.b.p).distance);
    for (const c of this.cords) c.rest.forEach((r, i) => { stretch = Math.max(stretch, distance(c.nodes[i].p, c.nodes[i + 1].p) / r); });
    return { penetration, stretch, sleeping:this.sleeping, rest:this.cords.map(c=>{const s=this.restState(c);return {sleeping:s.sleeping,quietTime:s.quietTime,idleTime:s.idleTime};}), rejectedSteps: this.rejectedSteps, lastRejection: this.lastRejection, steps: this.steps, simulationTime: this.simulationTime, metersPerUnit: METERS_PER_UNIT, docking: this.docking.map(d => ({ cord: d.cord, index: d.index, port: d.dock, blocked:this.dockingBlocked(d) })), feel: { ...this.feel }, finite: this.cords.every(c => c.nodes.every(n => Number.isFinite(dot(n.p, n.p)))) };
  }
}
