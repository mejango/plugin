import { describe, expect, it } from "vitest";
import { PatchWorld } from "../src/lib/patchboard/physics";
import { DEFAULT_FEEL } from "../src/lib/patchboard/settings";
import { screenLayout } from "../src/lib/patchboard/layout";
import { distance, v } from "../src/lib/patchboard/math";

const positions=(w:PatchWorld)=>w.cords.map(c=>c.nodes.map(n=>({...n.p})));
const placed=()=>{
  const layout=screenLayout(1440,1000),w=new PatchWorld(layout,{seed:41,cables:layout.cables});
  w.configure(DEFAULT_FEEL);return w;
};

describe("already-placed startup",()=>{
  it.each([[320,568],[390,844],[1440,1000],[2048,1164],[844,390]])("starts %s × %s exactly still without a warm-up simulation",(width,height)=>{
    const layout=screenLayout(width,height),w=new PatchWorld(layout,{seed:41,cables:layout.cables});
    w.configure(DEFAULT_FEEL);const before=positions(w);
    expect(w.restInitialPlacement()).toBe(true);
    expect(w.steps).toBe(0);expect(w.simulationTime).toBe(0);expect(w.sleeping).toBe(true);
    expect(positions(w)).toEqual(before);
    for(let i=0;i<120;i++)w.advance(1/60);
    expect(positions(w)).toEqual(before);
    expect(w.diagnostics().penetration).toBe(0);
    expect(w.cords.every(c=>c.nodes.every(n=>n.velocity.x===0&&n.velocity.y===0&&n.velocity.z===0))).toBe(true);
  });
  it("wakes the selected cable immediately and cannot freeze an active simulation",()=>{
    const w=placed();w.restInitialPlacement();w.grab(0,0);
    expect(w.diagnostics().rest.flatMap((r,i)=>r.sleeping?[]:[i])).toEqual([0]);
    expect(w.restInitialPlacement()).toBe(false);
    const p=w.cords[0].nodes[0].p;w.grip!.target=v(p.x,p.y+0.1,p.z+0.3);w.advance(1/60);
    expect(distance(w.cords[0].nodes[0].p,w.grip!.target)).toBeLessThan(0.001);
    w.release();expect(w.restInitialPlacement()).toBe(false);expect(w.sleeping).toBe(false);
  });
  it("never puts an unsupported or intersecting initial cable to sleep",()=>{
    const loose=placed();loose.cords[0].ports=[null,null];
    expect(loose.restInitialPlacement()).toBe(false);expect(loose.sleeping).toBe(false);
    const intersecting=new PatchWorld();
    intersecting.cords[1].nodes.forEach((n,i)=>{n.p={...intersecting.cords[0].nodes[i].p};});
    expect(intersecting.restInitialPlacement()).toBe(false);expect(intersecting.sleeping).toBe(false);
  });
});
