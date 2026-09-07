import { expect, it } from 'vitest';
import { PatchWorld } from '../src/lib/patchboard/physics';
import { screenLayout } from '../src/lib/patchboard/layout';

it.each([7,42,2026])('settles crossed cords after repeated handling (seed %i)', seed => {
  const layout=screenLayout(1440,900);
  const w=new PatchWorld(layout,{seed,cables:layout.cables});
  w.restInitialPlacement();
  for(let attempt=0;attempt<3;attempt++) {
    const ci=attempt%w.cords.length, c=w.cords[ci],other=w.cords[(ci+1)%w.cords.length];
    w.grab(ci,Math.floor(c.nodes.length/2));
    w.grip!.target={...other.nodes[Math.floor(other.nodes.length/2)].p};
    for(let i=0;i<30;i++) w.advance(1/30);
    w.release();
    for(let i=0;i<1000&&!w.sleeping;i++) w.advance([1/60,1/144,1/30][i%3]);
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
    const before=w.cords.map(c=>c.nodes.map(n=>({...n.p})));
    for(let i=0;i<60;i++)w.advance(1/30);
    expect(w.cords.map(c=>c.nodes.map(n=>n.p))).toEqual(before);
    expect(w.diagnostics().penetration).toBeLessThan(.004);
  }
},60000);

it('keeps idle damping accumulated when a released cord bumps a settled crossing',()=>{
  const w=new PatchWorld();w.cords=w.cords.slice(0,2);
  for(let i=0;i<360;i++)w.advance(1/60);
  expect(w.sleeping).toBe(true);
  const [supported,falling]=w.cords;
  const idle=w.diagnostics().rest[0].idleTime;
  falling.ports=[null,null];
  falling.nodes.forEach((n,i)=>{
    n.p={...supported.nodes[i].p,z:supported.nodes[i].p.z+.4};
    n.old={...n.p};n.velocity={x:0,y:0,z:-2};n.mass=1;
  });
  for(let i=0;i<120&&w.isResting(supported);i++)w.advance(1/120);
  expect(w.isResting(supported)).toBe(false);
  expect(w.diagnostics().rest[0].idleTime).toBeGreaterThanOrEqual(idle);
},30000);
