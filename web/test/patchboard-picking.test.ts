import { describe, expect, it } from "vitest";
import { v, type V3 } from "../src/lib/patchboard/math";
import { pickCord } from "../src/lib/patchboard/picking";

const cord=(points:V3[])=>({nodes:points.map(p=>({p}))});
const project=(p:V3)=>p;
const sideways=()=>cord([v(0,0,5),v(40,0,4),v(55,0,4),v(85,0,4),v(115,0,4),v(145,0,4),v(175,0,4),v(190,0,4),v(230,0,5)]);

describe("patchboard plug picking",()=>{
  it.each([0,20,40,55])("treats the tip, shaft, elbow and boot as the first plug at x=%i",x=>{
    expect(pickCord([sideways()],{x,y:0},project)).toMatchObject({cord:0,index:0});
  });
  it.each([175,190,210,230])("normalizes the other connector to its physical endpoint at x=%i",x=>{
    expect(pickCord([sideways()],{x,y:0},project)).toMatchObject({cord:0,index:8});
  });
  it("keeps an identifiable floor plug pickable over its own folded cable",()=>{
    const c=sideways();c.nodes[4].p=v(40,6,1);
    expect(pickCord([c],{x:40,y:0},project)).toMatchObject({cord:0,index:0});
  });
  it("handles a plug pointing toward the camera without a projected shaft length",()=>{
    const c=sideways();c.nodes[0].p=v(40,0,5);c.nodes[2].p=v(40,0,3);
    expect(pickCord([c],{x:40,y:0},project)).toMatchObject({cord:0,index:0,z:3});
  });
  it("does not unplug a cable hidden behind a different cable's body",()=>{
    const back=sideways(),front=sideways();
    front.nodes.forEach(n=>{n.p.y=100;});front.nodes[4].p=v(40,0,1);
    expect(pickCord([back,front],{x:40,y:0},project)).toMatchObject({cord:1,index:4});
    front.nodes[4].p.z=8;
    expect(pickCord([back,front],{x:40,y:0},project)).toMatchObject({cord:0,index:0});
  });
  it("chooses the front connector when two plugs overlap",()=>{
    const back=sideways(),front=sideways();front.nodes.forEach(n=>{n.p.z-=2;});
    expect(pickCord([back,front],{x:40,y:0},project)).toMatchObject({cord:1,index:0});
  });
  it("still grabs the body away from the connector and misses empty space",()=>{
    expect(pickCord([sideways()],{x:115,y:0},project)).toMatchObject({cord:0,index:4});
    expect(pickCord([sideways()],{x:115,y:30},project)).toBeNull();
    expect(pickCord([],{x:0,y:0},project)).toBeNull();
  });
});
