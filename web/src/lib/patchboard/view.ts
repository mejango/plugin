import { add, clamp, cross, dot, length, lerp, mul, sub, unit, v, type V3 } from "./math";
import { PatchWorld, PLUG_RADIUS, RADIUS } from "./physics";
import { frameSeconds } from "./clock";
import { type CableFeel, DEFAULT_FEEL } from "./settings";
import { panelArtwork } from "./artwork";

type Color = number[];
const TAU = Math.PI * 2;
class Mesh {
  data: number[] = [];
  vertex(p: V3, n: V3, c: Color) { this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2]); }
  triangle(a: V3, b: V3, c: V3, color: Color) {
    const n = unit(cross(sub(b, a), sub(c, a)));
    this.vertex(a, n, color); this.vertex(b, n, color); this.vertex(c, n, color);
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: Color) { this.triangle(a, b, c, color); this.triangle(a, c, d, color); }
  // Clip projected shadows to the actual receiving surface, including its edge.
  clippedQuad(points: V3[], bounds: [keyof V3, number, number][], color: Color) {
    for(const [axis,lo,hi] of bounds)for(const [edge,sign] of [[lo,1],[hi,-1]]){
      const result: V3[]=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length];
        const insideA=(a[axis]-edge)*sign>=0,insideB=(b[axis]-edge)*sign>=0;
        if(insideA)result.push(a);
        if(insideA!==insideB)result.push(lerp(a,b,(edge-a[axis])/(b[axis]-a[axis])));
      }
      points=result;
    }
    for(let i=1;i<points.length-1;i++)this.triangle(points[0],points[i],points[i+1],color);
  }
  box(a: V3, b: V3, c: Color) {
    const p = [v(a.x,a.y,a.z),v(b.x,a.y,a.z),v(b.x,b.y,a.z),v(a.x,b.y,a.z),v(a.x,a.y,b.z),v(b.x,a.y,b.z),v(b.x,b.y,b.z),v(a.x,b.y,b.z)];
    for (const [i,j,k,l] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]) this.quad(p[i],p[j],p[k],p[l],c);
  }
  cylinder(a: V3, b: V3, radius: number, color: Color, sides = 10, endRadius = radius) {
    const axis = unit(sub(b, a));
    const right = unit(cross(axis, Math.abs(axis.y) > 0.9 ? v(1,0,0) : v(0,1,0)));
    const up = cross(axis, right);
    for (let i = 0; i < sides; i++) {
      const n = add(mul(right, Math.cos(i / sides * TAU)), mul(up, Math.sin(i / sides * TAU)));
      const m = add(mul(right, Math.cos((i + 1) / sides * TAU)), mul(up, Math.sin((i + 1) / sides * TAU)));
      const p = add(a, mul(n,radius)), q = add(a,mul(m,radius)), r = add(b,mul(n,endRadius)), s = add(b,mul(m,endRadius));
      for (const [pt, normal] of [[p,n],[r,n],[q,m],[q,m],[r,n],[s,m]]) this.vertex(pt,normal,color);
      this.triangle(a, q, p, color); this.triangle(b, r, s, color);
    }
  }
  sphere(p: V3, radius: number, color: Color) {
    for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) {
      const normal = (u: number, w: number) => v(Math.sin(w * Math.PI / 6) * Math.cos(u * TAU / 10), Math.cos(w * Math.PI / 6), Math.sin(w * Math.PI / 6) * Math.sin(u * TAU / 10));
      const ns = [normal(i,j), normal(i+1,j), normal(i+1,j+1), normal(i,j+1)];
      for (const k of [0,1,2,0,2,3]) this.vertex(add(p,mul(ns[k],radius)),ns[k],color);
    }
  }
  tube(points: V3[], color: Color) {
    let right = v(1,0,0);
    const rings = points.map((p,i) => {
      const axis = unit(sub(points[Math.min(points.length-1,i+1)],points[Math.max(0,i-1)]));
      right = unit(sub(right,mul(axis,dot(right,axis))));
      if (length(right)<0.1) right = unit(cross(axis,v(0,0,1)));
      const up = cross(axis,right);
      return Array.from({length:10},(_,j) => {
        const n = add(mul(right,Math.cos(j*TAU/10)),mul(up,Math.sin(j*TAU/10)));
        return { p:add(p,mul(n,RADIUS)),n };
      });
    });
    for (let i=0;i<rings.length-1;i++) for(let j=0;j<10;j++) {
      const k=(j+1)%10;
      for(const pt of [rings[i][j],rings[i+1][j],rings[i][k],rings[i][k],rings[i+1][j],rings[i+1][k]]) this.vertex(pt.p,pt.n,color);
    }
  }
}

export type PatchboardController = { reset: () => void; view: (front: boolean) => void; configure: (settings: CableFeel) => void; dispose: () => void };
export type BoardStatus = { held: boolean; depth: number; connected: number; docking: boolean; blocked: boolean };

export function startPatchboard(canvas: HTMLCanvasElement, onStatus: (status: BoardStatus) => void, settings = DEFAULT_FEEL, angle = false): PatchboardController {
  const gl = canvas.getContext("webgl", { antialias:true, alpha:false });
  if (!gl) throw new Error("This patchboard needs WebGL. Enable hardware acceleration and reload.");
  const world = new PatchWorld(angle?{columns:12,rows:7,top:7.45,gap:1.05}:undefined);
  world.configure(settings);
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s,source); gl.compileShader(s);
    if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "Shader compilation failed");
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, `
    precision mediump float;
    attribute vec3 position; attribute vec3 normal; attribute vec3 color;
    uniform vec3 eye; uniform vec3 right; uniform vec3 up; uniform vec3 forward; uniform float aspect; uniform float orthographic;
    varying vec3 tint; varying vec3 norm; varying vec3 pos;
    void main(){vec3 p=position-eye; float z=dot(p,forward); float w=orthographic>0.0?orthographic:z; float clipZ=orthographic>0.0?((z-0.1)/99.9*2.0-1.0)*w:1.002002*z-0.2002002; gl_Position=vec4(dot(p,right)*1.95/aspect,dot(p,up)*1.95,clipZ,w);tint=color;norm=normal;pos=position;}
  `);
  const fs = shader(gl.FRAGMENT_SHADER, `
    precision mediump float; varying vec3 tint; varying vec3 norm; varying vec3 pos; uniform vec3 eye; uniform sampler2D artwork;
    void main(){vec3 n=normalize(norm); vec3 light=normalize(vec3(-0.5,0.9,0.8)); float diffuse=max(0.0,dot(n,light)); vec3 h=normalize(light+normalize(eye-pos)); float spec=pow(max(0.0,dot(n,h)),48.0)*0.19;
    ${angle ? `vec3 l=normalize(vec3(-4.1,8.8,5.0)-pos);vec3 r=normalize(vec3(4.1,8.8,5.0)-pos);diffuse=0.5*(max(0.0,dot(n,l))+max(0.0,dot(n,r)));spec=0.07*(pow(max(0.0,dot(n,normalize(l+normalize(eye-pos)))),48.0)+pow(max(0.0,dot(n,normalize(r+normalize(eye-pos)))),48.0));` : ""}
    vec3 surface=tint;
    ${angle ? `if(abs(pos.z)<0.001 && n.z>0.9 && abs(pos.x)<6.5 && pos.y>=0.0 && pos.y<=8.5){vec4 ink=texture2D(artwork,vec2((pos.x+6.5)/13.0,(8.5-pos.y)/8.5));surface=mix(surface,ink.rgb,ink.a);}` : ""}
    gl_FragColor=vec4(surface*(${angle ? "0.82+0.18" : "0.56+0.44"}*diffuse)+spec,1.0);
    ${angle ? `if(abs(pos.z)<0.001 && n.z>0.9)gl_FragColor=vec4(surface,1.0);` : ""}}
  `);
  const program = gl.createProgram()!; gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Could not initialize the 3D renderer");
  gl.useProgram(program); gl.enable(gl.DEPTH_TEST); gl.clearColor(0.925,0.915,0.887,1);
  if(angle)gl.clearColor(1,1,1,1);
  const artwork=angle?gl.createTexture():null;
  if(artwork){
    gl.bindTexture(gl.TEXTURE_2D,artwork);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,panelArtwork(world.sockets));
    gl.uniform1i(gl.getUniformLocation(program,"artwork"),0);
  }
  const buffer=gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [i,name] of ["position","normal","color"].entries()) { const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,36,i*12); }
  const uniforms=Object.fromEntries(["eye","right","up","forward","aspect","orthographic"].map(n=>[n,gl.getUniformLocation(program,n)]));
  const overlay=document.createElement("canvas"); overlay.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  canvas.parentElement!.appendChild(overlay);
  const ctx=overlay.getContext("2d")!;
  const defaultZoom=angle?8:16.8;
  let width=1,height=1,yaw=angle?0:0.18,pitch=angle?0:0.13,zoom=defaultZoom;
  const focus=v(0,angle?3.6:3.5,0.5);
  const fittedZoom=()=>angle?Math.max(defaultZoom,12.2*0.975/(width/height)):Math.max(defaultZoom,12.3/(width/height));
  const orthographic=()=>angle&&yaw===0&&pitch===0;
  let eye=v(),right=v(),up=v(),forward=v();
  const camera=()=> {
    if(angle&&yaw===0&&pitch===0)focus.y=(0.5-Math.min(48/height,0.06))*zoom/0.975;
    eye=add(focus,v(Math.sin(yaw)*Math.cos(pitch)*zoom,Math.sin(pitch)*zoom,Math.cos(yaw)*Math.cos(pitch)*zoom));
    forward=unit(sub(focus,eye));right=unit(cross(forward,v(0,1,0)));up=cross(right,forward);
  };
  const setView=(front:boolean)=>{yaw=front?0:0.5;pitch=front?0:0.28;zoom=fittedZoom();camera();};
  camera();
  const project=(p:V3)=> {const d=sub(p,eye),z=dot(d,forward),scale=height*0.975/(orthographic()?zoom:z);return {x:width/2+dot(d,right)*scale,y:height/2-dot(d,up)*scale,z};};
  const unproject=(x:number,y:number,z:number)=> {
    if(orthographic())return v(focus.x+(x-width/2)*zoom/(height*0.975),focus.y+(height/2-y)*zoom/(height*0.975),z);
    const ray=add(forward,add(mul(right,(x-width/2)/(height*0.975)),mul(up,(height/2-y)/(height*0.975))));
    return add(eye,mul(ray,(z-eye.z)/ray.z));
  };
  let sized=false;
  const resize=()=> {
    const previousFit=fittedZoom();
    const rect=canvas.getBoundingClientRect(); width=rect.width;height=rect.height;
    zoom=angle?(sized?zoom/previousFit:1)*fittedZoom():Math.max(zoom,12.3/(width/height));sized=true;camera();
    const dpr=Math.min(window.devicePixelRatio,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    overlay.width=canvas.width;overlay.height=canvas.height;ctx.setTransform(dpr,0,0,dpr,0,0);
    gl.viewport(0,0,canvas.width,canvas.height);
  };
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  const board=new Mesh();
  if(angle){
    // Extend the presentation surfaces past the viewport; socket spacing and
    // the physical world stay unchanged. The floor remains visible below y=0.
    board.box(v(-100,-0.6,-0.45),v(100,0,8),[0.94,0.94,0.93]);
    board.box(v(-100,0,-0.3),v(100,50,0),[1,1,1]);
    for(const p of world.sockets){
      board.cylinder(v(p.x,p.y,0.005),v(p.x,p.y,0.022),0.255,[0.83,0.83,0.83],6);
      board.cylinder(v(p.x,p.y,0.023),v(p.x,p.y,0.028),0.237,[1,1,1],6);
      board.cylinder(v(p.x,p.y,0.029),v(p.x,p.y,0.04),0.181,[0.9,0.9,0.9],32);
      board.cylinder(v(p.x,p.y,0.041),v(p.x,p.y,0.05),0.152,[0.63,0.63,0.63],32);
      board.cylinder(v(p.x,p.y,0.051),v(p.x,p.y,0.06),0.132,[0.95,0.95,0.95],32);
      board.cylinder(v(p.x,p.y,0.061),v(p.x,p.y,0.07),0.091,[0.4,0.4,0.4],32);
    }
  }else{
  board.box(v(-7,-0.2,-0.45),v(7,0,8),[0.79,0.78,0.73]);
  board.box(v(-5.7,0,-0.3),v(5.7,7.55,0),[0.84,0.83,0.78]);
  board.box(v(-5.82,0,-0.34),v(-5.7,7.65,0.05),[0.31,0.30,0.27]);
  board.box(v(5.7,0,-0.34),v(5.82,7.65,0.05),[0.31,0.30,0.27]);
  board.box(v(-5.82,7.55,-0.34),v(5.82,7.65,0.05),[0.31,0.30,0.27]);
  for(const p of world.sockets) {
    board.cylinder(v(p.x,p.y,0.01),v(p.x,p.y,0.055),0.19,[0.40,0.41,0.39],20);
    board.cylinder(v(p.x,p.y,0.056),v(p.x,p.y,0.063),0.135,[0.69,0.69,0.64],20);
    board.cylinder(v(p.x,p.y,0.064),v(p.x,p.y,0.07),0.091,[0.09,0.105,0.10],20);
  }
  for(const x of [-5.4,5.4]) for(const y of [0.4,7.2]) {
    board.cylinder(v(x,y,0),v(x,y,0.045),0.065,[0.45,0.45,0.41],12);
    board.box(v(x-0.039,y-0.008,0.046),v(x+0.039,y+0.008,0.05),[0.18,0.18,0.16]);
  }
  }
  let pointer={x:0,y:0}, orbit=false, down=false, depth=0.55, hoverPort:number|null=null;
  let activePointer:number|null=null;
  let frontDrag=false;
  let seatedGrip: { cord: number; index: number; origin: V3 } | null = null;
  const pick=()=> {
    let hit:{cord:number;index:number;z:number}|null=null;
    world.cords.forEach((c,ci)=>c.nodes.forEach((n,i)=>{
      const p=project(n.p),end=i<2||i>c.nodes.length-3;
      if(Math.hypot(pointer.x-p.x,pointer.y-p.y)<(end?16:9) && (!hit||p.z<hit.z)) hit={cord:ci,index:i,z:p.z};
    }));
    const selected=hit as {cord:number;index:number;z:number}|null;
    if(selected){
      const c=world.cords[selected.cord],last=c.nodes.length-1;
      for(const end of [0,last]){
        const p=project(c.nodes[end].p);
        if(Math.abs(selected.index-end)<=3&&Math.hypot(pointer.x-p.x,pointer.y-p.y)<16)selected.index=end;
      }
    }
    return selected;
  };
  const updateTarget=()=> {
    if(!down) return;
    let p=unproject(pointer.x,pointer.y,depth);
    if(seatedGrip){
      if(length(sub(p,seatedGrip.origin))<world.feel.socketResistance)return;
      world.grab(seatedGrip.cord,seatedGrip.index);seatedGrip=null;
    }
    if(!world.grip)return;
    if(frontDrag){
      // A hand picks an end up in front of the other cables. The solver still
      // moves it through space and rejects blocked paths; this is not a layer
      // swap or a teleport through an existing crossing. Wheel input opts out.
      let clearance=0.3;
      world.cords.forEach((c,ci)=>{if(ci!==world.grip!.cord)for(const n of c.nodes)clearance=Math.max(clearance,n.p.z+n.radius+PLUG_RADIUS+0.03);});
      depth=Math.max(depth,Math.min(6.5,clearance));
      p=unproject(pointer.x,pointer.y,depth);
    }
    world.grip.target=v(clamp(p.x,-6.5,6.5),clamp(p.y,PLUG_RADIUS,9),depth);
    hoverPort=null;
    const aperture=unproject(pointer.x,pointer.y,0.07);
    for(const [i,s] of world.sockets.entries()) {
      if(!world.occupied(i)&&Math.hypot(aperture.x-s.x,aperture.y-s.y)<=0.091 && (depth<0.95||(frontDrag&&world.feel.socketAssist))) {hoverPort=i;break;}
    }
    // Socket assist applies on release, never redirects an end being held.
  };
  const pointerDown=(e:PointerEvent)=> {
    if(activePointer!==null) return;
    const rect=canvas.getBoundingClientRect();pointer={x:e.clientX-rect.left,y:e.clientY-rect.top};
    if(e.button===2 || e.altKey) orbit=true;
    else if(e.button===0) {
      const hit=pick();if(!hit)return;
      const c=world.cords[hit.cord],end=hit.index===0?0:hit.index===c.nodes.length-1?1:null;
      frontDrag=end!==null;
      depth=c.nodes[hit.index].p.z;
      if(end!==null&&c.ports[end]!==null&&world.feel.socketResistance>0)seatedGrip={cord:hit.cord,index:hit.index,origin:{...c.nodes[hit.index].p}};
      else world.grab(hit.cord,hit.index);
      down=true;updateTarget();
    } else return;
    activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);canvas.style.cursor="grabbing";
  };
  const pointerMove=(e:PointerEvent)=> {
    const rect=canvas.getBoundingClientRect(),next={x:e.clientX-rect.left,y:e.clientY-rect.top};
    if(orbit){yaw=clamp(yaw+(next.x-pointer.x)*0.004,-0.9,0.9);pitch=clamp(pitch+(next.y-pointer.y)*0.004,-0.05,0.65);camera();}
    pointer=next;updateTarget();
    if(!down&&!orbit)canvas.style.cursor=pick()?"grab":"default";
  };
  const pointerUp=(e:PointerEvent)=> {
    if(e.pointerId!==activePointer)return;
    if(down){
      const rect=canvas.getBoundingClientRect();
      pointer={x:e.clientX-rect.left,y:e.clientY-rect.top};updateTarget();
      let port=e.type==="pointercancel"?null:hoverPort;
      if(port!==null&&world.grip){
        const g=world.grip,tip=project(world.cords[g.cord].nodes[g.index].p);
        const actual=unproject(tip.x,tip.y,0.07),socket=world.sockets[port];
        // A cursor over the hole cannot insert a plug still blocked beside it.
        if(Math.hypot(actual.x-socket.x,actual.y-socket.y)>0.091)port=null;
      }
      if(port!==null&&!world.feel.socketAssist&&world.grip){
        const g=world.grip;
        if(length(sub(world.cords[g.cord].nodes[g.index].p,world.sockets[port]))>0.18)port=null;
      }
      world.release(port,frontDrag&&world.feel.socketAssist);
    }
    down=false;orbit=false;hoverPort=null;activePointer=null;seatedGrip=null;canvas.style.cursor="default";
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  };
  const cancel=()=>{if(down||world.grip)world.release();down=false;orbit=false;activePointer=null;hoverPort=null;seatedGrip=null;};
  const wheel=(e:WheelEvent)=> {
    e.preventDefault();
    if(down){frontDrag=false;depth=clamp(depth-e.deltaY*0.004,0.3,6.5);updateTarget();}
    else{zoom=clamp(zoom+e.deltaY*0.012,angle?5:11,Math.max(24,18/(width/height)));camera();}
  };
  const key=(e:KeyboardEvent)=> {
    if((e.target as HTMLElement)?.matches("input,button,select,textarea"))return;
    if(e.key==="Escape"){if(!down&&!world.grip)world.cancelDocking();cancel();}
    if(e.key.toLowerCase()==="r"){cancel();world.reset();}
    if(e.key.toLowerCase()==="f")setView(true);
    if(e.key.toLowerCase()==="o")setView(false);
    if(down&&(e.key==="ArrowUp"||e.key==="ArrowDown")){e.preventDefault();frontDrag=false;depth=clamp(depth+(e.key==="ArrowUp"?0.15:-0.15),0.3,6.5);updateTarget();}
  };
  const context=(e:Event)=>e.preventDefault();
  canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);
  canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);canvas.addEventListener("lostpointercapture",pointerUp);
  canvas.addEventListener("wheel",wheel,{passive:false});canvas.addEventListener("contextmenu",context);window.addEventListener("keydown",key);window.addEventListener("blur",cancel);
  let frame=0,last:number|null=null,disposed=false,lastStatus=0;
  let timing={physicsMs:0,renderMs:0,frameMs:0,substeps:0};
  const visibility=()=>{last=null;if(document.hidden)cancel();};
  document.addEventListener("visibilitychange",visibility);
  const render=(time:number)=> {
    if(disposed)return;
    const begin=performance.now(),beforeSteps=world.steps;
    const elapsed=frameSeconds(last,time);last=time;
    if(!document.hidden&&elapsed>0)world.advance(elapsed);
    const physicsEnd=performance.now();
    const mesh=new Mesh();
    // Geometry uses the solver's polyline directly; visual splines cannot cut
    // corners through contacts or misrepresent which cord is in front.
    for(const c of world.cords) {
      const pts=c.nodes.map(n=>n.p);
      for(let i=0;i<pts.length-1;i++) {
        const a=pts[i],b=pts[i+1];
        if(angle){
          // The same inward-set point lights used in the material shader.
          for(const lx of [-4.1,4.1])for(const floor of [false,true]){
            const light=v(lx,8.8,5),axis=floor?"y":"z",plane=floor?0.004:0.002;
            if(a[axis]>=light[axis]-0.1||b[axis]>=light[axis]-0.1)continue;
            const projectShadow=(p:V3)=>add(light,mul(sub(p,light),(plane-light[axis])/(p[axis]-light[axis])));
            const sa=projectShadow(a),sb=projectShadow(b);
            const normal=floor?v(0,1,0):v(0,0,1);
            const scale=Math.min(3,light[axis]/(light[axis]-(a[axis]+b[axis])/2));
            const w=mul(unit(cross(sub(sb,sa),normal)),RADIUS*scale);
            const bounds: [keyof V3,number,number][]=floor?[["x",-100,100],["z",-0.45,8]]:[["x",-100,100],["y",0,50]];
            const shade=floor?[0.85,0.85,0.84]:[0.92,0.92,0.92];
            mesh.clippedQuad([sub(sa,w),add(sa,w),add(sb,w),sub(sb,w)],bounds,shade);
            // Round joins keep the projected physical polyline continuous.
            const cap=Array.from({length:10},(_,j)=>{
              const x=Math.cos(j*TAU/10)*RADIUS*scale,y=Math.sin(j*TAU/10)*RADIUS*scale;
              return add(sa,floor?v(x,0,y):v(x,y,0));
            });
            mesh.clippedQuad(cap,bounds,shade);
          }
          continue;
        }
        const sa=v(a.x+0.25*a.y,0.004,a.z+0.22*a.y),sb=v(b.x+0.25*b.y,0.004,b.z+0.22*b.y);
        const d=unit(cross(sub(sb,sa),v(0,1,0))),w=mul(d,RADIUS*1.3);
        mesh.quad(sub(sa,w),add(sa,w),add(sb,w),sub(sb,w),[0.61,0.60,0.55]);
        const wa=v(a.x+0.2*a.z,a.y-0.6*a.z,0.002),wb=v(b.x+0.2*b.z,b.y-0.6*b.z,0.002);
        if(wa.y>0&&wb.y>0){const q=mul(unit(cross(sub(wb,wa),v(0,0,1))),RADIUS*1.2);mesh.quad(sub(wa,q),add(wa,q),add(wb,q),sub(wb,q),[0.70,0.69,0.64]);}
      }
      mesh.tube(angle?pts.slice(1,-1):pts,c.color);
      c.ports.forEach((port,end)=>{if(port!==null){const p=pts[end===0?0:pts.length-1];mesh.cylinder(v(p.x,p.y,0.07),p,PLUG_RADIUS,[0.32,0.33,0.31],14);}});
      for(const end of [0,pts.length-1]) {
        const neighbour=end===0?1:pts.length-2;
        if(angle){
          const tip=pts[end],elbow=pts[neighbour],seated=c.ports[end===0?0:1]!==null;
          const chrome=[0.78,0.81,0.83],insulator=[0.10,0.11,0.12];
          const at=(t:number)=>lerp(tip,elbow,t);
          if(!seated){
            // The metal tip ends at the physical endpoint; nothing protrudes
            // beyond the existing plug capsule or changes the grab position.
            mesh.cylinder(at(0),at(0.10),0.025,chrome,18,0.058);
            mesh.cylinder(at(0.10),at(0.64),0.058,chrome,18);
            for(const t of [0.18,0.40])mesh.cylinder(at(t),at(t+0.045),0.059,insulator,18);
            mesh.cylinder(at(0.61),at(0.70),0.082,chrome,18);
          }
          const body=at(seated?0:0.7);
          mesh.cylinder(body,elbow,PLUG_RADIUS*0.92,c.color,18);
          mesh.sphere(elbow,PLUG_RADIUS*0.92,c.color);
          // Molded right-angle elbow and flexible ribbed strain relief follow
          // the physical cable direction immediately behind the connector.
          const boot=pts[end===0?2:pts.length-3];
          mesh.cylinder(elbow,boot,0.096,c.color,16,0.07);
          const rib=c.color.map(n=>n*0.65);
          for(const t of [0.2,0.4,0.6,0.8])mesh.cylinder(lerp(elbow,boot,t),lerp(elbow,boot,t+0.06),0.097-t*0.026,rib,16);
          continue;
        }
        mesh.cylinder(pts[end],pts[neighbour],PLUG_RADIUS,c.color,14);
        mesh.sphere(pts[end],PLUG_RADIUS,c.color);
        mesh.cylinder(lerp(pts[end],pts[neighbour],0.15),lerp(pts[end],pts[neighbour],0.32),PLUG_RADIUS*1.015,[0.30,0.31,0.29],14);
      }
    }
    const data=new Float32Array(board.data.length+mesh.data.length);data.set(board.data);data.set(mesh.data,board.data.length);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    for(const [name,p]of Object.entries({eye,right,up,forward}))gl.uniform3f(uniforms[name],p.x,p.y,p.z);
    gl.uniform1f(uniforms.orthographic,orthographic()?zoom:0);
    gl.uniform1f(uniforms.aspect,width/height);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/9);
    ctx.clearRect(0,0,width,height);ctx.textAlign="center";ctx.font="10px ui-monospace, monospace";ctx.fillStyle="#73736b";
    if(!angle){
      for(const [i,s]of world.sockets.entries()){const p=project(add(s,v(0,0.35,-0.22)));ctx.fillText(`${String.fromCharCode(65+Math.floor(i/10))}${i%10+1}`,p.x,p.y);}
      const title=project(v(-4.7,7.06,0.08));ctx.textAlign="left";ctx.font="600 12px ui-monospace, monospace";ctx.fillStyle="#55574d";ctx.fillText("P A T C H   /   0 1",title.x,title.y);
    }
    if(world.grip) {
      const g=world.grip,p=project(world.cords[g.cord].nodes[g.index].p),target=project(g.target);
      ctx.strokeStyle="#555c52";ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(target.x,target.y);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(target.x,target.y,7,0,TAU);ctx.stroke();
    }
    if(hoverPort!==null){const s=world.sockets[hoverPort],p=project(v(s.x,s.y,0.07));ctx.strokeStyle="#44735b";ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,Math.abs(project(v(s.x+0.091,s.y,0.07)).x-p.x),0,TAU);ctx.stroke();}
    for(const dock of world.docking){
      const p=project(world.sockets[dock.dock!]);ctx.strokeStyle="#a47d35";ctx.lineWidth=1.5;ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.arc(p.x,p.y,14,0,TAU);ctx.stroke();ctx.setLineDash([]);
      if(world.dockingBlocked(dock)){ctx.textAlign="center";ctx.font="10px ui-monospace, monospace";ctx.fillStyle="#8a6025";ctx.fillText("NOT SEATED",p.x,p.y+29);}
    }
    if(time-lastStatus>100){lastStatus=time;onStatus({held:down,depth,connected:world.cords.reduce((n,c)=>n+c.ports.filter(p=>p!==null).length,0),docking:!down&&world.docking.length>0,blocked:!down&&world.docking.some(d=>world.dockingBlocked(d))});}
    timing={physicsMs:physicsEnd-begin,renderMs:performance.now()-physicsEnd,frameMs:elapsed*1000,substeps:world.steps-beforeSteps};
    frame=requestAnimationFrame(render);
  };
  // Read-only snapshots for reproducible browser verification.
  const debugCanvas=canvas as HTMLCanvasElement & { __patchboard?:()=>unknown };
  debugCanvas.__patchboard=()=>({ ...world.diagnostics(),timing:{...timing},grip:world.grip,sockets:world.sockets.map((p,i)=>({...project(p),hole:project(v(p.x,p.y,0.07)),position:{...p},occupied:world.occupied(i)})),cords:world.cords.map(c=>({ports:[...c.ports],points:c.nodes.map(n=>({...n.p,screen:project(n.p)}))})) });
  frame=requestAnimationFrame(render);
  return {
    reset:()=>{cancel();world.reset();},
    view:setView,
    configure:(settings)=>{world.configure(settings);},
    dispose:()=>{
      disposed=true;cancelAnimationFrame(frame);observer.disconnect();overlay.remove();delete debugCanvas.__patchboard;
      document.removeEventListener("visibilitychange",visibility);
      canvas.removeEventListener("pointerdown",pointerDown);canvas.removeEventListener("pointermove",pointerMove);canvas.removeEventListener("pointerup",pointerUp);canvas.removeEventListener("pointercancel",pointerUp);canvas.removeEventListener("lostpointercapture",pointerUp);
      canvas.removeEventListener("wheel",wheel);canvas.removeEventListener("contextmenu",context);window.removeEventListener("keydown",key);window.removeEventListener("blur",cancel);
      gl.deleteTexture(artwork);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    },
  };
}
