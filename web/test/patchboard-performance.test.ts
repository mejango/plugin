import { describe, expect, it } from "vitest";
import { PatchWorld } from "../src/lib/patchboard/physics";
import { screenLayout } from "../src/lib/patchboard/layout";
import { distance, lerp, v } from "../src/lib/patchboard/math";

const run=(w:PatchWorld,seconds:number)=>{for(let i=0;i<seconds*60;i++)w.advance(1/60);};
const populated=()=>{
  const layout=screenLayout(1440,1000),w=new PatchWorld(layout,{seed:41,cables:16});run(w,6);
  expect(w.sleeping).toBe(true);return w;
};

describe("local cable wake-up",()=>{
  it("keeps the cached broad phase equivalent to a full capsule search as cables wake",()=>{
    const w=populated();
    const check=()=>{
      const segments=w["segments"](),expected:string[]=[];
      const key=(a:typeof segments[number],b:typeof segments[number])=>[`${a.cord}/${a.index}`,`${b.cord}/${b.index}`].sort().join(":");
      for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
        const a=segments[i],b=segments[j];
        if(a.cord===b.cord&&Math.abs(a.index-b.index)<=3)continue;
        if(a.max.x<b.min.x||b.max.x<a.min.x||a.max.y<b.min.y||b.max.y<a.min.y||a.max.z<b.min.z||b.max.z<a.min.z)continue;
        expected.push(key(a,b));
      }
      expect(w["pairs"](segments).map(([a,b])=>key(a,b)).sort()).toEqual(expected.sort());
    };
    check();check();w.grab(0,0);check();
    w.grip!.target.z=1.2;run(w,0.25);check();
    w.release();run(w,6);check();
  });
  it("does not wake the touching network just because one anchored cable is grabbed",()=>{
    const w=populated();w.grab(0,0);
    expect(w.diagnostics().rest.flatMap((s,i)=>s.sleeping?[]:[i])).toEqual([0]);
  });
  it.each([30,60])("keeps remote anchored cables exactly still through a drag and hold at %i fps",fps=>{
    const w=populated(),c=w.cords[0];
    const far=w.cords.filter(other=>other!==c&&other.nodes.every(a=>c.nodes.every(b=>distance(a.p,b.p)>1)));
    expect(far.length).toBeGreaterThan(2);
    const before=far.map(c=>c.nodes.map(n=>({...n.p}))),ports=w.cords.map(c=>[...c.ports]);
    w.grab(0,0);
    const start={...w.grip!.target},target=v(start.x+0.105,start.y-0.245,1.16);
    for(let i=1;i<=12;i++){w.grip!.target=lerp(start,target,i/12);w.advance(1/fps);}
    for(let i=0;i<fps*1.5;i++)w.advance(1/fps);
    expect(distance(c.nodes[0].p,target)).toBeLessThan(0.001);
    expect(far.map(c=>c.nodes.map(n=>n.p))).toEqual(before);
    expect(w.cords.slice(1).map(c=>c.ports)).toEqual(ports.slice(1));
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
  });
});
