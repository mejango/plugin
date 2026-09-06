import { describe, expect, it } from "vitest";
import { distance, v } from "../src/lib/patchboard/math";
import { PatchWorld, PLUG_RADIUS, RADIUS } from "../src/lib/patchboard/physics";
import { cableShadowSpine, PANEL_SHADOW_Z, PATCH_LIGHTS, projectShadow } from "../src/lib/patchboard/shadows";

describe("connector shadows",()=>{
  it("joins both lights' shadows to every seated plug's actual panel intersection",()=>{
    const w=new PatchWorld({columns:12,rows:7,top:7.45,gap:1.05});
    for(const c of w.cords){
      const spine=cableShadowSpine(c);
      for(const end of [0,1] as const){
        const base=spine[end===0?0:spine.length-1],socket=w.sockets[c.ports[end]!];
        expect(base.p).toEqual(v(socket.x,socket.y,PANEL_SHADOW_Z));
        expect(base.radius).toBe(PLUG_RADIUS);
        for(const light of PATCH_LIGHTS)expect(distance(projectShadow(base.p,light,"z",PANEL_SHADOW_Z),base.p)).toBeLessThan(1e-12);
      }
    }
  });
  it.each([0,72])("removes only the grabbed end's panel connection at node %s",index=>{
    const w=new PatchWorld(),c=w.cords[0];w.grab(0,index);
    const spine=cableShadowSpine(c),end=index===0?spine[0]:spine.at(-1)!;
    const seated=index===0?spine.at(-1)!:spine[0];
    expect(end.p).toEqual(c.nodes[index].p);
    expect(end.radius).toBe(0.025);
    expect(seated.p.z).toBe(PANEL_SHADOW_Z);
    for(const light of PATCH_LIGHTS){
      const projection=projectShadow(end.p,light,"z",PANEL_SHADOW_Z);
      expect(Math.hypot(projection.x-end.p.x,projection.y-end.p.y)).toBeGreaterThan(0.05);
    }
  });
  it("does not invent a panel connection while a plug is still seating",()=>{
    const w=new PatchWorld(),c=w.cords[0];w.grab(0,0);w.release(1,true);
    expect(w.docking).toHaveLength(1);
    expect(c.ports[0]).toBeNull();
    expect(cableShadowSpine(c)[0].p).toEqual(c.nodes[0].p);
    expect(cableShadowSpine(c)[0].p.z).toBeGreaterThan(PANEL_SHADOW_Z);
  });
  it("includes the molded housing width without thickening the cable or changing physics",()=>{
    const c=new PatchWorld().cords[0],before=JSON.stringify(c);
    const spine=cableShadowSpine(c);
    expect(spine[2].radius).toBeCloseTo(PLUG_RADIUS*0.92);
    expect(spine[10].radius).toBe(RADIUS);
    expect(JSON.stringify(c)).toBe(before);
  });
});
