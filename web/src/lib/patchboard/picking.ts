import { clamp, type V3 } from "./math";

type PickableCord = { nodes: readonly { p: V3 }[] };
type Pick = { cord: number; index: number; z: number };

export function pickCord(cords: readonly PickableCord[], pointer: { x: number; y: number }, project: (p: V3) => V3): Pick | null {
  let body: Pick | null = null, plug: Pick | null = null;
  for(const [cord,c] of cords.entries())for(let index=2;index<c.nodes.length-2;index++){
    const p=project(c.nodes[index].p);
    if(Math.hypot(pointer.x-p.x,pointer.y-p.y)<9&&(!body||p.z<body.z))body={cord,index,z:p.z};
  }
  for(const [cord,c] of cords.entries())for(const end of [0,c.nodes.length-1]){
    const direction=end===0?1:-1;
    // The tip, elbow and strain relief form one handle. Always return the
    // physical endpoint, including when the plug lies sideways on the floor.
    for(let link=0;link<2;link++){
      const a=project(c.nodes[end+direction*link].p),b=project(c.nodes[end+direction*(link+1)].p);
      const dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy;
      const t=squared>1e-8?clamp(((pointer.x-a.x)*dx+(pointer.y-a.y)*dy)/squared,0,1):(b.z<a.z?1:0);
      if(Math.hypot(pointer.x-a.x-dx*t,pointer.y-a.y-dy*t)>=16)continue;
      const z=a.z+(b.z-a.z)*t;
      // Prefer a cable's own handle over its folded body at the same screen
      // position. A different cable in front still occludes a plug behind it.
      if(body&&body.cord!==cord&&body.z<z)continue;
      if(!plug||z<plug.z)plug={cord,index:end,z};
    }
  }
  return plug??body;
}
