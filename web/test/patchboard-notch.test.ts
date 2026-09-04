import { expect, it } from "vitest";
import { PatchWorld, type Cord } from "../src/lib/patchboard/physics";
import { distance, lerp, v, type V3 } from "../src/lib/patchboard/math";

function shape(c: Cord, points: V3[], ports: [number | null, number | null]) {
  const arc=[0];for(let i=1;i<points.length;i++)arc.push(arc[i-1]+distance(points[i-1],points[i]));
  c.ports=ports;
  c.nodes.forEach((n,i)=>{
    const length=arc.at(-1)!*i/(c.nodes.length-1);let j=1;
    while(j<points.length-1&&arc[j]<length)j++;
    n.p=lerp(points[j-1],points[j],(length-arc[j-1])/(arc[j]-arc[j-1]));
    n.old={...n.p};n.velocity=v();n.mass=(ports[0]!==null&&i<2)||(ports[1]!==null&&i>c.nodes.length-3)?0:1;
  });
  c.rest=c.nodes.slice(1).map((n,i)=>distance(c.nodes[i].p,n.p));
  c.bend=c.nodes.slice(2).map((n,i)=>distance(c.nodes[i].p,n.p));
}

it("pulls available slack around a seated plug instead of freezing the cord",()=>{
  const w=new PatchWorld();w.cords=w.cords.slice(1);
  w.configure({...w.feel,bend:0.95,settling:10,damping:4.5,cordFriction:1.15});
  const blue=w.cords[0],yellow=w.cords[1];
  shape(blue,[v(3.675,5.05,0.3),v(3.675,5.05,0.52),v(3.4,3.6,0.7),v(2.8,2.5,0.8),v(1.8,2.15,0.8),v(1,2.6,0.7),v(0.525,6.4,0.52),v(0.525,6.4,0.3)],[18,5]);
  shape(yellow,[v(2.625,6.4,0.3),v(2.625,6.4,0.52),v(2.75,3.5,0.85),v(3.1,2.95,0.95),v(3.65,3.15,0.95),v(4.1,5.15,0.4),v(3.85,5.4,0.3),v(2.4,4.6,0.3)],[7,null]);
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
  w.grab(1,72);
  const start={...yellow.nodes[72].p},target=v(0.8,4.5,0.3);
  let worstLag=0;
  for(let i=1;i<=60;i++){
    w.grip!.target=lerp(start,target,i/60);w.advance(1/60);
    worstLag=Math.max(worstLag,distance(yellow.nodes[72].p,w.grip!.target));
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
  }
  expect(worstLag).toBeLessThan(0.08);
  for(let i=0;i<60;i++)w.advance(1/60);
  expect(distance(yellow.nodes[72].p,target),JSON.stringify(w.diagnostics())).toBeLessThan(0.08);
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
  expect(blue.ports).toEqual([18,5]);
  const materialLength=yellow.rest.reduce((sum,r)=>sum+r,0);
  const currentLength=yellow.nodes.slice(1).reduce((sum,n,i)=>sum+distance(n.p,yellow.nodes[i].p),0);
  expect(currentLength/materialLength).toBeLessThan(1.047);
  // A genuinely solid obstruction must still stop the hand.
  w.grip!.target={...blue.nodes[0].p};
  for(let i=0;i<30;i++)w.advance(1/60);
  expect(distance(yellow.nodes[72].p,blue.nodes[0].p)).toBeGreaterThan(0.24);
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});
