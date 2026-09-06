import { describe, expect, it } from "vitest";
import { dampCableRipples, PatchWorld, STEP } from "../src/lib/patchboard/physics";
import { distance, lerp, v } from "../src/lib/patchboard/math";
import { FEEL_PRESETS } from "../src/lib/patchboard/settings";

const run=(w:PatchWorld,seconds:number)=>{for(let i=0;i<seconds*60;i++)w.advance(1/60);};
const positions=(w:PatchWorld)=>w.cords[0].nodes.map(n=>({...n.p}));

describe("held cable stability",()=>{
  it("damps tiny ripples while preserving broad motion and translational momentum",()=>{
    const nodes=new PatchWorld().cords[0].nodes;
    nodes.forEach((n,i)=>{n.mass=i===0?1/3:1;n.velocity=v(i%2?1:-1,-4,2);});
    const momentum=()=>nodes.reduce((sum,n)=>sum+n.velocity.x/n.mass,0);
    const energy=()=>nodes.reduce((sum,n)=>sum+n.velocity.x**2/n.mass,0);
    const initialMomentum=momentum(),initialEnergy=energy();
    for(let i=0;i<0.1/STEP;i++)dampCableRipples(nodes,STEP);
    expect(energy()).toBeLessThan(initialEnergy*0.05);
    expect(momentum()).toBeCloseTo(initialMomentum,9);
    expect(nodes.every(n=>n.velocity.y===-4&&n.velocity.z===2)).toBe(true);
    nodes.forEach((n,i)=>{n.mass=1;n.velocity.x=Math.sin(i/(nodes.length-1)*Math.PI*2);});
    const broadEnergy=energy();
    for(let i=0;i<0.1/STEP;i++)dampCableRipples(nodes,STEP);
    expect(energy()).toBeGreaterThan(broadEnergy*0.9);
    nodes[0].velocity=v(20,-10,5);nodes[1].mass=0;
    const fixed={...nodes[1].velocity};
    dampCableRipples(nodes,0.1,nodes[0]);
    expect(nodes[0].velocity).toEqual(v(20,-10,5));
    expect(nodes[1].velocity).toEqual(fixed);
  });
  it.each(["¼-inch cable","Soft cable","Firm + fast settling"])("quiets a held cable without cursor lag with %s",preset=>{
    const w=new PatchWorld({columns:12,rows:7,top:7.45,gap:1.05});w.configure(FEEL_PRESETS[preset]);run(w,5);
    w.grab(0,0);
    const start={...w.grip!.target},target=v(start.x+0.8,start.y-0.6,1.2);
    for(let i=1;i<=30;i++){
      w.grip!.target=lerp(start,target,i/30);w.advance(i%2?1/60:1/90);
      expect(distance(w.cords[0].nodes[0].p,w.grip!.target)).toBeLessThan(0.001);
    }
    run(w,5);
    const before=positions(w);run(w,1);
    expect(positions(w),"a stationary hand must not leave perpetual solver chatter").toEqual(before);
    expect(w.grip?.cord).toBe(0);
    expect(w.cords[0].ports[0]).toBeNull();
    const moved=v(target.x+0.15,target.y+0.1,target.z);
    w.grip!.target=moved;w.advance(1/60);
    expect(distance(w.cords[0].nodes[0].p,moved)).toBeLessThan(0.001);
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
  });
  it("wakes a cable immediately when a stationary grip is released",()=>{
    const w=new PatchWorld();w.grab(0,0);w.grip!.target.z=1.2;run(w,6);
    const y=w.cords[0].nodes[0].p.y;
    w.release();run(w,0.1);
    expect(w.cords[0].nodes[0].p.y).toBeLessThan(y-0.3);
    expect(w.grip).toBeNull();
  });
});
