import { describe, expect, it } from "vitest";
import { PatchWorld, STEP, type Cord } from "../src/lib/patchboard/physics";
import { distance, dot, length, lerp, sub, v, type V3 } from "../src/lib/patchboard/math";
import { FEEL_PRESETS } from "../src/lib/patchboard/settings";

const run = (w: PatchWorld, seconds: number) => { for (let i = 0; i < seconds / STEP; i++) w.step(); };
const frames = (w: PatchWorld, seconds: number) => { for(let i=0;i<seconds*30;i++)w.advance(1/30); };
const positions=(c:Cord)=>c.nodes.map(n=>({...n.p}));
const shape=(c:Cord,path:V3[],fixed=false)=>{
  const arc=[0];for(let i=1;i<path.length;i++)arc.push(arc[i-1]+distance(path[i-1],path[i]));
  c.nodes.forEach((n,i)=>{
    const d=arc.at(-1)!*i/(c.nodes.length-1);let j=1;
    while(j<path.length-1&&arc[j]<d)j++;
    n.p=lerp(path[j-1],path[j],(d-arc[j-1])/(arc[j]-arc[j-1]));n.old={...n.p};n.velocity=v();n.mass=fixed?0:1;
  });
  c.rest=c.nodes.slice(1).map((n,i)=>distance(c.nodes[i].p,n.p));
  c.bend=c.nodes.slice(2).map((n,i)=>distance(c.nodes[i].p,n.p));
};

describe("untouched cable rest", () => {
  it("settles completely and wakes as soon as a cable is grabbed", () => {
    const w = new PatchWorld(); run(w, 10);
    expect(w.sleeping).toBe(true);
    for(const c of w.cords)for(let i=4;i<c.nodes.length-5;i++){
      const a=sub(c.nodes[i].p,c.nodes[i-1].p),b=sub(c.nodes[i+1].p,c.nodes[i].p);
      const turn=Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(length(a)*length(b)))));
      expect(turn,`localized kink at node ${i}`).toBeLessThan(0.4);
    }
    const positions = w.cords.flatMap(c => c.nodes.map(n => ({ ...n.p })));
    run(w, 2);
    expect(w.cords.flatMap(c => c.nodes.map(n => n.p))).toEqual(positions);
    w.grab(0, 0); expect(w.sleeping).toBe(false);
    const from = { ...w.cords[0].nodes[0].p };
    w.grip!.target.x += 0.1; w.advance(1 / 60);
    expect(distance(from, w.cords[0].nodes[0].p)).toBeGreaterThan(0.09);
  });
  it("dissipates an idle disturbance even with the settling slider at zero", () => {
    const w = new PatchWorld();
    w.configure({ ...w.feel, settling: 0, damping: 0 });
    w.cords[0].nodes.forEach(n => { if (n.mass) n.velocity = v(1, 0, 2); });
    run(w, 15);
    expect(w.sleeping).toBe(true);
  });
  it("does not put an unsupported cord to sleep in midair", () => {
    const w = new PatchWorld(); w.cords = w.cords.slice(0, 1);
    const c = w.cords[0]; c.ports = [null, null];
    c.nodes.forEach(n => { n.mass = 1; n.p.y += 20; n.old = { ...n.p }; });
    w.advance(0.2);
    expect(w.sleeping).toBe(false);
    expect(c.nodes[36].velocity.y).toBeLessThan(-30);
  });
  it("gives cables subtly different coil sets and learns only the handled cord", () => {
    const w=new PatchWorld();
    const turns=w.cords.map(c=>c.bend.map((b,i)=>Math.acos(Math.max(-1,Math.min(1,(b*b-c.rest[i]**2-c.rest[i+1]**2)/(2*c.rest[i]*c.rest[i+1]))))));
    expect(turns[0]).not.toEqual(turns[1]);
    turns[0].forEach((t,i)=>expect(Math.abs(t-turns[1][i])).toBeLessThan(0.02));
    const before=w.cords.map(c=>[...c.bend]);
    w.grab(0,36);w.grip!.target.x+=0.2;run(w,0.5);
    expect(w.cords[0].bend).not.toEqual(before[0]);
    expect(w.cords[1].bend).toEqual(before[1]);
    w.configure({...w.feel,shapeMemory:false});
    const disabled=[...w.cords[0].bend];run(w,0.5);
    expect(w.cords[0].bend).toEqual(disabled);
  });
  it("leaves unrelated resting cords exactly still while another one is handled",()=>{
    const w=new PatchWorld();run(w,6);expect(w.sleeping).toBe(true);
    const before=w.cords.slice(1).map(positions);
    w.grab(0,36);w.grip!.target.x-=0.25;frames(w,2);
    expect(w.cords.slice(1).map(positions)).toEqual(before);
    expect(w.diagnostics().rest.slice(1).every(s=>s.sleeping)).toBe(true);
  });
  it("wakes a resting cable when a moving cable contacts it without detaching its plugs",()=>{
    const w=new PatchWorld();run(w,6);
    const before=positions(w.cords[1]),ports=[...w.cords[1].ports];
    w.grab(0,72);w.grip!.target={...w.cords[1].nodes[36].p};frames(w,1);
    expect(w.cords[1].ports).toEqual(ports);
    expect(w.diagnostics().rest[1].sleeping).toBe(false);
    expect(Math.max(...w.cords[1].nodes.map((n,i)=>distance(n.p,before[i])))).toBeGreaterThan(0.01);
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
    w.release();frames(w,10);
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
  });
  it("recognizes a loose cable supported by another cable above the floor",()=>{
    const w=new PatchWorld();w.cords=w.cords.slice(0,2);
    const [bar,c]=w.cords;
    shape(bar,[v(-4.5,4.5,1.6),v(4.5,4.5,1.6)],true);
    const loop=Array.from({length:25},(_,i)=>v(0,4.5+0.25*Math.sin(i*Math.PI/24),1.6-0.25*Math.cos(i*Math.PI/24)));
    c.ports=[null,null];shape(c,[v(0,1.5,1.35),...loop,v(0,1.5,1.85)]);
    frames(w,12);
    expect(Math.min(...c.nodes.map(n=>n.p.y-n.radius))).toBeGreaterThan(0.1);
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
    const before=positions(c);frames(w,2);expect(positions(c)).toEqual(before);
    w.grab(0,0);
    expect(w.diagnostics().rest[1].sleeping,"a loose cable must wake when its supporting cable is disturbed").toBe(false);
  });
  it("lets an obstructed pending insertion rest without canceling it or disturbing other cords",()=>{
    const w=new PatchWorld(),socket=w.sockets[1];
    shape(w.cords[1],[v(socket.x,2,0.15),v(socket.x,9,0.15)],true);
    w.grab(0,0);w.grip!.target={...socket,z:0.6};frames(w,0.5);w.release(1);
    expect(w.docking).toHaveLength(1);frames(w,10);
    expect(w.docking).toHaveLength(1);
    expect(w.cords[0].ports[0]).toBeNull();
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
    const before=w.cords.map(positions);frames(w,2);expect(w.cords.map(positions)).toEqual(before);
    w.grab(2,0);
    expect(w.diagnostics().rest[0].sleeping).toBe(false);
    expect(w.docking).toHaveLength(1);
  });
  it.each([
    ...Object.entries(FEEL_PRESETS),
    ["minimum damping and friction",{...FEEL_PRESETS["¼-inch cable"],bend:0.05,settling:0,damping:0,cordFriction:0,floorFriction:0}],
    ["maximum stiffness and stretch",{...FEEL_PRESETS["¼-inch cable"],bend:8,settling:30,damping:8,stretch:1,plugWeight:6}],
  ] as const)("settles the dense board after a drop with %s",(_,feel)=>{
    const w=new PatchWorld({columns:12,rows:7,top:7.45,gap:1.05});w.configure(feel);
    w.grab(0,0);w.grip!.target.z=2;frames(w,0.5);w.release();
    // Deliberately undamped/frictionless extremes can swing longer with a
    // heavier plug; every supported configuration must still reach exact rest.
    for(let i=0;i<15*30&&!w.sleeping;i++)w.advance(1/30);
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
    const before=w.cords.map(positions);frames(w,2);expect(w.cords.map(positions)).toEqual(before);
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
  });
});
