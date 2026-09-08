import { expect, it } from "vitest";
import { PatchWorld, PLUG_RADIUS, RADIUS } from "../src/lib/patchboard/physics";
import { add, distance, lerp, v } from "../src/lib/patchboard/math";
import { FEEL_PRESETS } from "../src/lib/patchboard/settings";

it.each([0,1])("can reinsert loose end %i from the full table depth without teleporting",end=>{
  const w=new PatchWorld();w.cords=w.cords.slice(0,1);
  const c=w.cords[0],index=end===0?0:c.nodes.length-1;
  const socket=v(-4.725,0.53,0.3);w.sockets[0]=socket;c.ports=[null,null];
  const total=c.rest.reduce((sum,length)=>sum+length,0);let along=0;
  // A loose cable picked up just above the floor, farther out than the old
  // seven-unit insertion cutoff. Both ends are free to follow the approach.
  c.nodes.forEach((n,i)=>{
    n.p=v(socket.x+(end===0?along:total-along),socket.y,7.75);
    n.old={...n.p};n.velocity=v();n.mass=1;along+=c.rest[i]??0;
  });
  const before={...c.nodes[index].p};
  w.grab(0,index);w.release(0);
  expect(w.docking).toHaveLength(0); // Manual depth still requires proximity.
  w.grab(0,index);w.release(0,true);
  expect(w.docking).toHaveLength(1);
  expect(c.nodes[index].p).toEqual(before);expect(c.ports[end]).toBeNull();
  w.step();expect(distance(c.nodes[index].p,before)).toBeLessThan(0.028);
  for(let i=0;i<360&&c.ports[end]===null;i++)w.advance(1/60);
  expect(c.ports[end],JSON.stringify(w.diagnostics())).toBe(0);
  expect(c.nodes[index].p).toEqual(socket);
  expect(c.nodes[end===0?1:c.nodes.length-2].p).toEqual(add(socket,v(0,0,0.22)));
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});

it("does not cancel a pending insertion when another end is grabbed", () => {
  const w = new PatchWorld();
  w.grab(0, 0); w.release(0);
  expect(w.grip).toBeNull();
  expect(w.docking).toHaveLength(1);
  expect(w.occupied(0)).toBe(true);
  w.grab(1, 72);
  expect(w.docking).toHaveLength(1);
  for (let i = 0; i < 20; i++) w.advance(1 / 60);
  expect(w.cords[0].ports[0]).toBe(0);
  expect(w.docking).toHaveLength(0);
  expect(w.grip?.cord).toBe(1);
  expect(w.grip?.index).toBe(72);
  expect(w.cords[0].nodes[0].mass).toBe(0);
});

it("tracks independent pending insertions and only cancels the explicitly grabbed end", () => {
  const w = new PatchWorld();
  w.grab(0, 0);w.release(0);
  w.grab(1, 0);w.release(3);
  expect(w.docking).toHaveLength(2);
  w.grab(0, 0);
  expect(w.docking.map(d => d.cord)).toEqual([1]);
  for(let i=0;i<20;i++)w.advance(1/60);
  expect(w.cords[1].ports[0]).toBe(3);
  expect(w.cords[0].ports[0]).toBeNull();
  expect(w.grip?.cord).toBe(0);
});

it("keeps other seated plugs fixed when a held end presses across them", () => {
  const w = new PatchWorld();
  const seated = w.cords.slice(1).map(c => ({ ports: [...c.ports], a: { ...c.nodes[0].p }, b: { ...c.nodes[72].p } }));
  w.grab(0, 72);
  const start = { ...w.cords[0].nodes[72].p }, target = { ...w.cords[1].nodes[0].p };
  for(let i=1;i<=45;i++){
    w.grip!.target=lerp(start,target,i/45);w.advance(1/60);
    w.cords.slice(1).forEach((c,j)=>{
      expect(c.ports).toEqual(seated[j].ports);
      expect(distance(c.nodes[0].p,seated[j].a)).toBe(0);
      expect(distance(c.nodes[72].p,seated[j].b)).toBe(0);
    });
    expect(w.grip?.cord).toBe(0);
    expect(w.grip?.index).toBe(72);
  }
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});

it.each(Object.entries(FEEL_PRESETS))("fully inserts an angled plug under cable tension with %s",(_,feel)=>{
  const w=new PatchWorld({columns:12,rows:7,top:7.45,gap:1.05});w.configure(feel);
  w.grab(2,72);
  const target=w.sockets[11];
  w.grip!.target={...target,z:1.2};
  for(let i=0;i<45;i++)w.advance(1/60);
  expect(distance(w.cords[2].nodes[72].p,target)).toBeGreaterThan(0.65);
  expect(distance(w.cords[2].nodes[72].p,target)).toBeLessThan(1.5);
  w.release(11,true);
  expect(w.docking).toHaveLength(1);
  for(let i=0;i<120;i++)w.advance(1/60);
  expect(w.cords[2].ports[1],JSON.stringify(w.diagnostics())).toBe(11);
  expect(w.cords[2].nodes[72].p).toEqual(target);
  expect(w.cords[2].nodes[71].p).toEqual(add(target,v(0,0,0.22)));
  expect(w.docking).toHaveLength(0);
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});


it("keeps a blocked insertion clear of a crossing and retries when it clears",()=>{
  const w=new PatchWorld();w.cords=w.cords.slice(0,2);
  const [plug,obstruction]=w.cords,socket=w.sockets[1];
  obstruction.ports=[null,null];
  obstruction.nodes=obstruction.nodes.slice(0,9);
  obstruction.nodes.forEach((n,i)=>{
    n.p=v(socket.x-.4+.8*i/(obstruction.nodes.length-1),socket.y-1,.16);
    n.old={...n.p};n.velocity=v();n.mass=0;
    n.radius=RADIUS;
  });
  obstruction.rest=obstruction.nodes.slice(1).map((n,i)=>distance(n.p,obstruction.nodes[i].p));
  obstruction.bend=obstruction.nodes.slice(2).map((n,i)=>distance(n.p,obstruction.nodes[i].p));
  w.grab(0,0);w.grip!.target={...socket,z:1};
  for(let i=0;i<60;i++)w.advance(1/60);
  obstruction.nodes.forEach(n=>{n.p.y+=1;n.old={...n.p};});
  w.release(1,true);
  for(let i=0;i<240;i++)w.advance(1/60);
  expect(plug.ports[0]).toBeNull();
  expect(w.docking).toHaveLength(1);
  expect(plug.nodes[0].p.z).toBeGreaterThanOrEqual(.16+RADIUS+PLUG_RADIUS+.03);
  expect(w.diagnostics().penetration).toBeLessThan(.004);
  obstruction.nodes.forEach(n=>{n.p.y-=1;n.old={...n.p};});
  for(let i=0;i<180&&plug.ports[0]===null;i++)w.advance(1/60);
  expect(plug.ports[0],JSON.stringify(w.diagnostics())).toBe(1);
  expect(w.diagnostics().penetration).toBeLessThan(.004);
},30000);

it("holds a docking connector in front of a fold in its own cable",()=>{
  const w=new PatchWorld();w.cords=w.cords.slice(0,1);
  const c=w.cords[0],s=w.sockets[1];
  const points=[v(s.x,s.y,.42),v(s.x,s.y,.64),v(s.x+.6,s.y,.64),v(s.x+.6,s.y-.6,.16),v(s.x-.6,s.y-.6,.16),v(s.x-.6,s.y,.16),v(s.x+.6,s.y,.16),v(s.x+.6,s.y+.6,.16),v(s.x+1,s.y+.6,.16)];
  c.ports=[null,null];
  c.nodes=points.map((p,i)=>({p,old:{...p},velocity:v(),mass:0,radius:i<2?PLUG_RADIUS:RADIUS}));
  c.rest=points.slice(1).map((p,i)=>distance(p,points[i]));
  c.bend=points.slice(2).map((p,i)=>distance(p,points[i]));
  w.grab(0,0);w.release(1,true);
  for(let i=0;i<90;i++)w.advance(1/60);
  expect(c.ports[0]).toBeNull();
  expect(w.docking).toHaveLength(1);
  expect(c.nodes[0].p.z).toBeGreaterThanOrEqual(.16+RADIUS+PLUG_RADIUS+.025);
  expect(w.diagnostics().penetration).toBeLessThan(.004);
});
