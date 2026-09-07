import { describe, expect, it } from "vitest";
import { CABLE_LENGTHS, screenLayout, displayMount } from "../src/lib/patchboard/layout";
import { PatchWorld } from "../src/lib/patchboard/physics";
import { distance, v } from "../src/lib/patchboard/math";

const sizes=[[320,568],[320,844],[390,844],[768,1024],[1440,1000],[2048,1164],[2560,1440],[844,390]];

describe("responsive random patchboard",()=>{
  it.each(sizes)("fills %s × %s with sockets down to the table foot",(width,height)=>{
    const layout=screenLayout(width,height),scale=width/layout.width;
    const w=new PatchWorld(layout,{seed:12345,cables:layout.cables});
    const first=w.sockets[0],last=w.sockets.at(-1)!;
    expect(first).toBeDefined();
    expect(last.y*scale).toBeCloseTo((layout.trim+(layout.height-layout.trim)/layout.rows/2)*scale);
    expect(layout.foot).toBeLessThanOrEqual(32);
    const mount=displayMount(layout);
    expect(mount.keyY-mount.keySize/2).toBeCloseTo(mount.top-mount.height,10);
    expect(w.sockets).toHaveLength(layout.columns*layout.rows-2*(layout.displayColumns!+1)-2);
    for(const socket of w.sockets){
      expect(socket.x>mount.left&&socket.x<mount.left+mount.width&&socket.y<mount.top&&socket.y>mount.top-mount.height).toBe(false);
      expect(Math.abs(socket.x-mount.navX)<mount.navSize/2&&Math.abs(socket.y-mount.navY)<mount.navSize/2).toBe(false);
      expect(Math.abs(socket.x-mount.keyX)<mount.keySize/2&&Math.abs(socket.y-mount.keyY)<mount.keySize/2).toBe(false);
    }
    expect(w.cords.length,JSON.stringify({layout,count:w.cords.length})).toBeGreaterThanOrEqual(Math.min(layout.cables,8));
    const ports=w.cords.flatMap(c=>c.ports);
    expect(new Set(ports).size).toBe(ports.length);
    expect(w.diagnostics().penetration).toBe(0);
    for(const c of w.cords){
      expect(CABLE_LENGTHS).toContain(c.stockLength);
      expect(c.rest.reduce((a,b)=>a+b,0)).toBeCloseTo(c.stockLength!,9);
      for(const n of c.nodes)expect(n.p.y).toBeGreaterThan(n.radius);
    }
  });
  it("varies connections and colors with the seed and offers all three stock lengths",()=>{
    const layout=screenLayout(1440,1000);
    const a=new PatchWorld(layout,{seed:41,cables:layout.cables}),b=new PatchWorld(layout,{seed:42,cables:layout.cables});
    expect(a.cords.map(c=>c.ports)).not.toEqual(b.cords.map(c=>c.ports));
    expect(new Set(a.cords.map(c=>c.stockLength)).size).toBe(3);
    expect(new Set(a.cords.map(c=>c.color.join(","))).size).toBeGreaterThanOrEqual(4);
    const start=JSON.stringify(a.cords);a.reset();expect(JSON.stringify(a.cords)).toBe(start);
  });
  it("finds a safe, populated arrangement across different seeds and aspect ratios",()=>{
    for(const [width,height] of [[390,844],[1440,1000],[844,390]])for(let seed=0;seed<12;seed++){
      const layout=screenLayout(width,height),w=new PatchWorld(layout,{seed,cables:layout.cables});
      // The D-pad replaces one more socket; short landscape boards can fit three safe cables.
      expect(w.cords.length,`${width}×${height}, seed ${seed}`).toBeGreaterThanOrEqual(width===1440?12:height<width?3:6);
      expect(w.diagnostics().penetration).toBe(0);
    }
  },30000);
  it("settles a populated scene and preserves fixed plugs while dragging a variable-length end",()=>{
    const layout=screenLayout(1440,1000),w=new PatchWorld(layout,{seed:41,cables:layout.cables});
    for(let i=0;i<600;i++)w.advance(1/60);
    expect(w.sleeping,JSON.stringify(w.diagnostics())).toBe(true);
    const ports=w.cords.map(c=>[...c.ports]),c=w.cords[0],index=c.nodes.length-1;
    const tip={...c.nodes[index].p};w.grab(0,index);
    w.grip!.target=v(tip.x,tip.y+0.2,tip.z+0.3);w.advance(1/60);
    expect(distance(c.nodes[index].p,w.grip!.target)).toBeLessThan(0.001);
    expect(w.cords.slice(1).map(c=>c.ports)).toEqual(ports.slice(1));
    expect(w.diagnostics().penetration).toBeLessThan(0.004);
    w.release();for(let i=0;i<600;i++)w.advance(1/60);
    expect(w.sleeping).toBe(true);
  },30000);
  it.each(CABLE_LENGTHS)("grabs and fully reseats either end of a %s-unit cable",stockLength=>{
    for(const end of [0,1]){
      const layout=screenLayout(1440,1000),w=new PatchWorld(layout,{seed:41,cables:layout.cables});
      const c=w.cords.find(c=>c.stockLength===stockLength)!;w.cords=[c];
      const index=end===0?0:c.nodes.length-1,port=c.ports[end]!;
      w.grab(0,index);w.grip!.target.z=1.2;
      w.advance(1/60);
      expect(distance(c.nodes[index].p,w.grip!.target)).toBeLessThan(0.001);
      w.release(port,true);
      for(let i=0;i<360;i++)w.advance(1/60);
      expect(c.ports[end]).toBe(port);
      expect(c.nodes[index].p).toEqual(w.sockets[port]);
      expect(c.nodes[end===0?1:c.nodes.length-2].p).toEqual({...w.sockets[port],z:0.52});
      expect(w.diagnostics().penetration).toBeLessThan(0.004);
    }
  },30000);
});
