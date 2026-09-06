import { add, clamp, cross, dot, length, lerp, mul, sub, unit, v, type V3 } from "./math";
import { PatchWorld, PLUG_RADIUS, RADIUS, type Cord } from "./physics";
import { frameSeconds } from "./clock";
import { type CableFeel, DEFAULT_FEEL } from "./settings";
import { panelArtwork } from "./artwork";
import { cableShadowSpine, PANEL_SHADOW_Z, PATCH_LIGHTS, projectShadow } from "./shadows";
import { screenLayout } from "./layout";
import { rubberGrain, RUBBER_TEXTURE_SIZE } from "./material";

type Color = number[];
const TAU = Math.PI * 2;
const VERTEX_FLOATS = 11;
class Mesh {
  data: number[] = [];
  // A negative U marks non-rubber geometry (panel, shadows and metal).
  vertex(p: V3, n: V3, c: Color, u=-1, w=0) { this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2],u,w); }
  triangle(a: V3, b: V3, c: V3, color: Color, rubber=false) {
    const n = unit(cross(sub(b, a), sub(c, a)));
    const u=rubber?0.5:-1;
    this.vertex(a, n, color,u); this.vertex(b, n, color,u); this.vertex(c, n, color,u);
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
  cylinder(a: V3, b: V3, radius: number, color: Color, sides = 10, endRadius = radius, rubber=false) {
    const axis = unit(sub(b, a));
    const span=length(sub(b,a))/(TAU*radius);
    const right = unit(cross(axis, Math.abs(axis.y) > 0.9 ? v(1,0,0) : v(0,1,0)));
    const up = cross(axis, right);
    for (let i = 0; i < sides; i++) {
      const n = add(mul(right, Math.cos(i / sides * TAU)), mul(up, Math.sin(i / sides * TAU)));
      const m = add(mul(right, Math.cos((i + 1) / sides * TAU)), mul(up, Math.sin((i + 1) / sides * TAU)));
      const p = add(a, mul(n,radius)), q = add(a,mul(m,radius)), r = add(b,mul(n,endRadius)), s = add(b,mul(m,endRadius));
      const u=rubber?i/sides:-1,w=rubber?(i+1)/sides:-1;
      this.vertex(p,n,color,u,0);this.vertex(r,n,color,u,span);this.vertex(q,m,color,w,0);
      this.vertex(q,m,color,w,0);this.vertex(r,n,color,u,span);this.vertex(s,m,color,w,span);
      this.triangle(a, q, p, color,rubber); this.triangle(b, r, s, color,rubber);
    }
  }
  sphere(p: V3, radius: number, color: Color, rubber=false) {
    for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) {
      const normal = (u: number, w: number) => v(Math.sin(w * Math.PI / 6) * Math.cos(u * TAU / 10), Math.cos(w * Math.PI / 6), Math.sin(w * Math.PI / 6) * Math.sin(u * TAU / 10));
      const ns = [normal(i,j), normal(i+1,j), normal(i+1,j+1), normal(i,j+1)];
      const us=[i/10,(i+1)/10,(i+1)/10,i/10],ws=[j/6,j/6,(j+1)/6,(j+1)/6];
      for (const k of [0,1,2,0,2,3]) this.vertex(add(p,mul(ns[k],radius)),ns[k],color,rubber?us[k]:-1,ws[k]);
    }
  }
  tube(points: V3[], color: Color, rest: number[], phase=0) {
    let right = v(1,0,0);
    let along=phase;
    const rings = points.map((p,i) => {
      // Rest-length coordinates keep the grain attached to the cable as it
      // bends or stretches, rather than sampling a stationary world pattern.
      if(i)along+=rest[i-1]/(TAU*RADIUS);
      const axis = unit(sub(points[Math.min(points.length-1,i+1)],points[Math.max(0,i-1)]));
      right = unit(sub(right,mul(axis,dot(right,axis))));
      if (length(right)<0.1) right = unit(cross(axis,v(0,0,1)));
      const up = cross(axis,right);
      return Array.from({length:10},(_,j) => {
        const n = add(mul(right,Math.cos(j*TAU/10)),mul(up,Math.sin(j*TAU/10)));
        return { p:add(p,mul(n,RADIUS)),n,t:along };
      });
    });
    for (let i=0;i<rings.length-1;i++) for(let j=0;j<10;j++) {
      const k=(j+1)%10;
      const a=rings[i][j],b=rings[i+1][j],c=rings[i][k],d=rings[i+1][k],u=j/10,w=(j+1)/10;
      this.vertex(a.p,a.n,color,u,a.t);this.vertex(b.p,b.n,color,u,b.t);this.vertex(c.p,c.n,color,w,c.t);
      this.vertex(c.p,c.n,color,w,c.t);this.vertex(b.p,b.n,color,u,b.t);this.vertex(d.p,d.n,color,w,d.t);
    }
  }
}

export type PatchboardController = { reset: () => void; view: (front: boolean) => void; configure: (settings: CableFeel) => void; dispose: () => void };
export type BoardStatus = { held: boolean; depth: number; connected: number; total: number; docking: boolean; blocked: boolean };

export function startPatchboard(canvas: HTMLCanvasElement, onStatus: (status: BoardStatus) => void, settings = DEFAULT_FEEL, angle = false): PatchboardController {
  const gl = canvas.getContext("webgl", { antialias:true, alpha:false });
  if (!gl) throw new Error("This patchboard needs WebGL. Enable hardware acceleration and reload.");
  const bounds=canvas.getBoundingClientRect();
  let layout=screenLayout(bounds.width,bounds.height);
  const query=new URLSearchParams(window.location.search);
  const seed=query.has("seed")?Number(query.get("seed"))>>>0:crypto.getRandomValues(new Uint32Array(1))[0];
  const randomized=angle&&query.get("scene")!=="classic";
  let world = new PatchWorld(angle?layout:undefined,randomized?{seed,cables:layout.cables}:undefined);
  let lights=angle?[v(-layout.width*0.33,layout.height+0.4,5),v(layout.width*0.33,layout.height+0.4,5)]:PATCH_LIGHTS;
  const meshCache=new Map<Cord,{points:Float64Array;ports:string;buffer:WebGLBuffer;vertices:number}>();
  world.configure(settings);
  if(angle)world.restInitialPlacement();
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s,source); gl.compileShader(s);
    if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "Shader compilation failed");
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, `
    precision mediump float;
    attribute vec3 position; attribute vec3 normal; attribute vec3 color; attribute vec2 surface;
    uniform vec3 eye; uniform vec3 right; uniform vec3 up; uniform vec3 forward; uniform float aspect; uniform float orthographic;
    varying vec3 tint; varying vec3 norm; varying vec3 pos; varying vec2 rubberUV;
    void main(){vec3 p=position-eye; float z=dot(p,forward); float w=orthographic>0.0?orthographic:z; float clipZ=orthographic>0.0?((z-0.1)/99.9*2.0-1.0)*w:1.002002*z-0.2002002; gl_Position=vec4(dot(p,right)*1.95/aspect,dot(p,up)*1.95,clipZ,w);tint=color;norm=normal;pos=position;rubberUV=surface;}
  `);
  const fs = shader(gl.FRAGMENT_SHADER, `
    precision mediump float; varying vec3 tint; varying vec3 norm; varying vec3 pos; varying vec2 rubberUV; uniform vec3 eye; uniform vec3 forward; uniform float orthographic; uniform sampler2D artwork; uniform sampler2D rubber; uniform vec2 panelSize; uniform vec3 lightLeft; uniform vec3 lightRight;
    void main(){vec3 n=normalize(norm);
    ${angle ? `if(abs(pos.z)<0.003 && n.z>0.9){
      vec3 surface=tint;
      if(abs(pos.x)<panelSize.x*0.5 && pos.y>=0.0 && pos.y<=panelSize.y){vec4 ink=texture2D(artwork,vec2(pos.x/panelSize.x+0.5,1.0-pos.y/panelSize.y));surface*=mix(vec3(1.0),ink.rgb,ink.a);}
      gl_FragColor=vec4(surface,1.0);return;
    }
    if(abs(pos.y-0.004)<0.0005)n=vec3(0.0,1.0,0.0);` : ""}
    if(rubberUV.x>=0.0){
      vec3 view=orthographic>0.0?-forward:normalize(eye-pos);
      vec3 l=${angle?"normalize(lightLeft-pos)":"normalize(vec3(-0.5,0.9,0.8))"};
      vec3 r=${angle?"normalize(lightRight-pos)":"l"};
      float grain=texture2D(rubber,rubberUV).r-0.5;
      float diffuse=0.5*(max(0.0,dot(n,l))+max(0.0,dot(n,r)));
      float gloss=0.12*(pow(max(0.0,dot(n,normalize(l+view))),36.0)+pow(max(0.0,dot(n,normalize(r+view))),36.0));
      float edge=pow(1.0-max(0.0,dot(n,view)),3.0)*0.018;
      vec3 body=tint*(0.72+0.28*diffuse)*(1.0+0.055*grain);
      gl_FragColor=vec4(body+gloss*(1.0+0.25*grain)+edge,1.0);return;
    }
    vec3 light=normalize(vec3(-0.5,0.9,0.8)); float diffuse=max(0.0,dot(n,light)); vec3 h=normalize(light+normalize(eye-pos)); float spec=pow(max(0.0,dot(n,h)),48.0)*0.19;
    ${angle ? `vec3 l=normalize(lightLeft-pos);vec3 r=normalize(lightRight-pos);diffuse=0.5*(max(0.0,dot(n,l))+max(0.0,dot(n,r)));spec=0.07*(pow(max(0.0,dot(n,normalize(l+normalize(eye-pos)))),48.0)+pow(max(0.0,dot(n,normalize(r+normalize(eye-pos)))),48.0));` : ""}
    vec3 surface=tint;
    gl_FragColor=vec4(surface*(${angle ? "0.82+0.18" : "0.56+0.44"}*diffuse)+spec,1.0);
    }
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
    gl.uniform1i(gl.getUniformLocation(program,"artwork"),0);
  }
  const rubber=gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,rubber);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,RUBBER_TEXTURE_SIZE,RUBBER_TEXTURE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,rubberGrain());
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);gl.uniform1i(gl.getUniformLocation(program,"rubber"),1);
  gl.activeTexture(gl.TEXTURE0);
  const buffer=gl.createBuffer()!;
  const attributes=["position","normal","color","surface"].map(name=>gl.getAttribLocation(program,name));
  for(const a of attributes)gl.enableVertexAttribArray(a);
  const bindMesh=(buffer:WebGLBuffer)=>{
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    attributes.forEach((a,i)=>gl.vertexAttribPointer(a,i===3?2:3,gl.FLOAT,false,VERTEX_FLOATS*4,i*12));
  };
  const uniforms=Object.fromEntries(["eye","right","up","forward","aspect","orthographic","panelSize","lightLeft","lightRight"].map(n=>[n,gl.getUniformLocation(program,n)]));
  const overlay=document.createElement("canvas"); overlay.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  canvas.parentElement!.appendChild(overlay);
  const ctx=overlay.getContext("2d")!;
  const defaultZoom=angle?8:16.8;
  let width=1,height=1,yaw=angle?0:0.18,pitch=angle?0:0.13,zoom=defaultZoom;
  const focus=v(0,angle?3.6:3.5,0.5);
  const fittedZoom=()=>angle?layout.width*0.975/(width/height):Math.max(defaultZoom,12.3/(width/height));
  const orthographic=()=>angle&&yaw===0&&pitch===0;
  let eye=v(),right=v(),up=v(),forward=v(),cameraRevision=0;
  const camera=()=> {
    if(angle&&yaw===0&&pitch===0)focus.y=(0.5-layout.foot/height)*zoom/0.975;
    // Orthographic framing is independent of camera distance. Short/wide
    // viewports must not put the camera inside the cable's depth range.
    const distance=orthographic()?Math.max(10,zoom):zoom;
    eye=add(focus,v(Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance));
    forward=unit(sub(focus,eye));right=unit(cross(forward,v(0,1,0)));up=cross(right,forward);
    cameraRevision++;
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
    const next=screenLayout(width,height);
    if(angle&&sized&&(next.columns!==layout.columns||next.rows!==layout.rows||Math.abs(next.height-layout.height)>0.01)){
      // Responsive reflow is a new physical board, not a stretch/teleport of
      // live cables through one another. Keep the page seed and cable feel.
      cancel();
      const feel=world.feel;layout=next;
      world=new PatchWorld(layout,randomized?{seed,cables:layout.cables}:undefined);world.configure(feel);
      world.restInitialPlacement();
      lights=[v(-layout.width*0.33,layout.height+0.4,5),v(layout.width*0.33,layout.height+0.4,5)];
      buildBoard();
    }else if(angle&&!sized)layout=next;
    zoom=angle?(sized?zoom/previousFit:1)*fittedZoom():Math.max(zoom,12.3/(width/height));sized=true;camera();
    const dpr=Math.min(window.devicePixelRatio,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    overlay.width=canvas.width;overlay.height=canvas.height;ctx.setTransform(dpr,0,0,dpr,0,0);
    gl.viewport(0,0,canvas.width,canvas.height);
  };
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  let board=new Mesh();
  const buildBoard=()=>{
  board=new Mesh();
  if(angle){
    gl.bindTexture(gl.TEXTURE_2D,artwork);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,panelArtwork(world.sockets,layout.width,layout.height));
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
  };
  buildBoard();
  let pointer={x:0,y:0}, orbit=false, down=false, depth=0.55, hoverPort:number|null=null;
  let activePointer:number|null=null;
  let frontDrag=false;
  let seatedGrip: { cord: number; index: number } | null = null;
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
  const updateTarget=(beginDrag=false)=> {
    if(!down) return;
    let p=unproject(pointer.x,pointer.y,depth);
    if(seatedGrip){
      // A click leaves the plug seated; the first actual drag movement releases
      // it immediately, with no screen- or world-space distance threshold.
      if(!beginDrag)return;
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
    world.grip.target=v(clamp(p.x,-6.5,6.5),clamp(p.y,PLUG_RADIUS,angle?Math.max(9,layout.height+0.5):9),depth);
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
      if(end!==null&&c.ports[end]!==null)seatedGrip={cord:hit.cord,index:hit.index};
      else world.grab(hit.cord,hit.index);
      down=true;updateTarget();
    } else return;
    activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);canvas.style.cursor="grabbing";
  };
  const pointerMove=(e:PointerEvent)=> {
    if(activePointer!==null&&e.pointerId!==activePointer)return;
    const rect=canvas.getBoundingClientRect(),next={x:e.clientX-rect.left,y:e.clientY-rect.top};
    const moved=next.x!==pointer.x||next.y!==pointer.y;
    if(orbit){yaw=clamp(yaw+(next.x-pointer.x)*0.004,-0.9,0.9);pitch=clamp(pitch+(next.y-pointer.y)*0.004,-0.05,0.65);camera();}
    pointer=next;updateTarget(moved);
    if(!down&&!orbit)canvas.style.cursor=pick()?"grab":"default";
  };
  const pointerUp=(e:PointerEvent)=> {
    if(e.pointerId!==activePointer)return;
    if(down){
      if(e.type==="pointerup"){
        const rect=canvas.getBoundingClientRect();
        pointer={x:e.clientX-rect.left,y:e.clientY-rect.top};updateTarget();
      }
      // Cancellation may have no valid pointer position; drop without docking
      // or turning a pending click into a drag.
      let port=e.type==="pointerup"?hoverPort:null;
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
  const reset=()=>{cancel();world.reset();if(angle)world.restInitialPlacement();};
  const adjustDepth=(delta:number)=>{
    if(delta===0)return;
    const next=clamp(depth+delta,0.3,6.5),moved=next!==depth;
    frontDrag=false;depth=next;updateTarget(moved);
  };
  const wheel=(e:WheelEvent)=> {
    e.preventDefault();
    if(down)adjustDepth(-e.deltaY*0.004);
    else if(!angle){zoom=clamp(zoom+e.deltaY*0.012,11,Math.max(24,fittedZoom()*3));camera();}
  };
  const key=(e:KeyboardEvent)=> {
    if(canvas.closest("[inert]"))return;
    if((e.target as HTMLElement)?.matches("input,button,select,textarea"))return;
    if(e.key==="Escape"){if(!down&&!world.grip)world.cancelDocking();cancel();}
    if(e.key.toLowerCase()==="r")reset();
    if(e.key.toLowerCase()==="f")setView(true);
    if(e.key.toLowerCase()==="o")setView(false);
    if(down&&(e.key==="ArrowUp"||e.key==="ArrowDown")){e.preventDefault();adjustDepth(e.key==="ArrowUp"?0.15:-0.15);}
  };
  const context=(e:Event)=>e.preventDefault();
  canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);
  canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);canvas.addEventListener("lostpointercapture",pointerUp);
  canvas.addEventListener("wheel",wheel,{passive:false});canvas.addEventListener("contextmenu",context);window.addEventListener("keydown",key);window.addEventListener("blur",cancel);
  let frame=0,last:number|null=null,disposed=false,lastStatus=0;
  let timing={physicsMs:0,renderMs:0,frameMs:0,substeps:0,rebuiltCords:[] as number[],uploadedBytes:0,drawCalls:0};
  let uploadedBoard:Mesh|null=null,boardVertices=0,drawnCamera=-1,previousStatus="";
  const visibility=()=>{last=null;if(document.hidden)cancel();};
  document.addEventListener("visibilitychange",visibility);
  const render=(time:number)=> {
    if(disposed)return;
    const begin=performance.now(),beforeSteps=world.steps;
    const elapsed=frameSeconds(last,time);last=time;
    if(!document.hidden&&elapsed>0)world.advance(elapsed);
    const physicsEnd=performance.now();
    let uploadedBytes=0,sceneChanged=false,drawCalls=0;
    const rebuiltCords:number[]=[];
    for(const [cord,cached] of meshCache)if(!world.cords.includes(cord)){
      gl.deleteBuffer(cached.buffer);meshCache.delete(cord);sceneChanged=true;
    }
    // Geometry uses the solver's polyline directly; visual splines cannot cut
    // corners through contacts or misrepresent which cord is in front.
    const meshes=world.cords.map((c,ci)=>{
      const cached=meshCache.get(c);
      const ports=c.ports.join(",");
      if(cached&&cached.ports===ports&&cached.points.length===c.nodes.length*3&&c.nodes.every((n,i)=>n.p.x===cached.points[i*3]&&n.p.y===cached.points[i*3+1]&&n.p.z===cached.points[i*3+2]))return cached;
      const mesh=new Mesh();
      const pts=c.nodes.map(n=>n.p);
      const shadow=angle?cableShadowSpine(c):pts.map(p=>({p,radius:RADIUS}));
      for(let i=0;i<shadow.length-1;i++) {
        const a=shadow[i].p,b=shadow[i+1].p;
        if(angle){
          // The same inward-set point lights used in the material shader.
          for(const light of lights)for(const floor of [false,true]){
            const axis=floor?"y":"z",plane=floor?0.004:PANEL_SHADOW_Z;
            if(a[axis]>=light[axis]-0.1||b[axis]>=light[axis]-0.1)continue;
            const sa=projectShadow(a,light,axis,plane),sb=projectShadow(b,light,axis,plane);
            const normal=floor?v(0,1,0):v(0,0,1);
            const radiusA=shadow[i].radius*Math.min(3,(light[axis]-plane)/(light[axis]-a[axis]));
            const radiusB=shadow[i+1].radius*Math.min(3,(light[axis]-plane)/(light[axis]-b[axis]));
            const side=unit(cross(sub(sb,sa),normal)),wa=mul(side,radiusA),wb=mul(side,radiusB);
            const bounds: [keyof V3,number,number][]=floor?[["x",-100,100],["z",-0.45,8]]:[["x",-100,100],["y",0,50]];
            // A faint tint of the receiving surface; panel engraving remains
            // visible underneath, without lighting darkening the shadow again.
            const shade=floor?[0.925,0.925,0.915]:[0.97,0.97,0.97];
            mesh.clippedQuad([sub(sa,wa),add(sa,wa),add(sb,wb),sub(sb,wb)],bounds,shade);
            // Round joins keep the projected physical polyline continuous.
            const caps=i===shadow.length-2?[[sa,radiusA],[sb,radiusB]] as const:[[sa,radiusA]] as const;
            for(const [center,radius] of caps){
              const cap=Array.from({length:10},(_,j)=>{
                const x=Math.cos(j*TAU/10)*radius,y=Math.sin(j*TAU/10)*radius;
                return add(center,floor?v(x,0,y):v(x,y,0));
              });
              mesh.clippedQuad(cap,bounds,shade);
            }
          }
          continue;
        }
        const sa=v(a.x+0.25*a.y,0.004,a.z+0.22*a.y),sb=v(b.x+0.25*b.y,0.004,b.z+0.22*b.y);
        const d=unit(cross(sub(sb,sa),v(0,1,0))),w=mul(d,RADIUS*1.3);
        mesh.quad(sub(sa,w),add(sa,w),add(sb,w),sub(sb,w),[0.61,0.60,0.55]);
        const wa=v(a.x+0.2*a.z,a.y-0.6*a.z,0.002),wb=v(b.x+0.2*b.z,b.y-0.6*b.z,0.002);
        if(wa.y>0&&wb.y>0){const q=mul(unit(cross(sub(wb,wa),v(0,0,1))),RADIUS*1.2);mesh.quad(sub(wa,q),add(wa,q),add(wb,q),sub(wb,q),[0.70,0.69,0.64]);}
      }
      mesh.tube(angle?pts.slice(1,-1):pts,c.color,angle?c.rest.slice(1,-1):c.rest,ci*0.371);
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
          mesh.cylinder(body,elbow,PLUG_RADIUS*0.92,c.color,18,PLUG_RADIUS*0.92,true);
          mesh.sphere(elbow,PLUG_RADIUS*0.92,c.color,true);
          // Molded right-angle elbow and flexible ribbed strain relief follow
          // the physical cable direction immediately behind the connector.
          const boot=pts[end===0?2:pts.length-3];
          mesh.cylinder(elbow,boot,0.096,c.color,16,0.07,true);
          const rib=c.color.map(n=>n*0.65);
          for(const t of [0.2,0.4,0.6,0.8])mesh.cylinder(lerp(elbow,boot,t),lerp(elbow,boot,t+0.06),0.097-t*0.026,rib,16,0.097-t*0.026,true);
          continue;
        }
        mesh.cylinder(pts[end],pts[neighbour],PLUG_RADIUS,c.color,14,PLUG_RADIUS,true);
        mesh.sphere(pts[end],PLUG_RADIUS,c.color,true);
        mesh.cylinder(lerp(pts[end],pts[neighbour],0.15),lerp(pts[end],pts[neighbour],0.32),PLUG_RADIUS*1.015,[0.30,0.31,0.29],14);
      }
      const data=new Float32Array(mesh.data),points=new Float64Array(c.nodes.length*3);
      c.nodes.forEach((n,i)=>{points[i*3]=n.p.x;points[i*3+1]=n.p.y;points[i*3+2]=n.p.z;});
      const entry={points,ports,buffer:cached?.buffer??gl.createBuffer()!,vertices:data.length/VERTEX_FLOATS};
      gl.bindBuffer(gl.ARRAY_BUFFER,entry.buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      uploadedBytes+=data.byteLength;rebuiltCords.push(ci);sceneChanged=true;
      meshCache.set(c,entry);return entry;
    });
    if(uploadedBoard!==board){
      const data=new Float32Array(board.data);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      uploadedBytes+=data.byteLength;uploadedBoard=board;boardVertices=data.length/VERTEX_FLOATS;sceneChanged=true;
    }
    if(sceneChanged||drawnCamera!==cameraRevision){
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      for(const [name,p]of Object.entries({eye,right,up,forward}))gl.uniform3f(uniforms[name],p.x,p.y,p.z);
      gl.uniform1f(uniforms.orthographic,orthographic()?zoom:0);
      if(angle){gl.uniform2f(uniforms.panelSize,layout.width,layout.height);gl.uniform3f(uniforms.lightLeft,lights[0].x,lights[0].y,lights[0].z);gl.uniform3f(uniforms.lightRight,lights[1].x,lights[1].y,lights[1].z);}
      gl.uniform1f(uniforms.aspect,width/height);
      bindMesh(buffer);gl.drawArrays(gl.TRIANGLES,0,boardVertices);drawCalls++;
      for(const mesh of meshes){bindMesh(mesh.buffer);gl.drawArrays(gl.TRIANGLES,0,mesh.vertices);drawCalls++;}
      drawnCamera=cameraRevision;
    }
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
    if(time-lastStatus>100){
      lastStatus=time;
      const status={held:down,depth,connected:world.cords.reduce((n,c)=>n+c.ports.filter(p=>p!==null).length,0),total:world.cords.length*2,docking:!down&&world.docking.length>0,blocked:!down&&world.docking.some(d=>world.dockingBlocked(d))};
      const key=JSON.stringify(status);if(key!==previousStatus){previousStatus=key;onStatus(status);}
    }
    timing={physicsMs:physicsEnd-begin,renderMs:performance.now()-physicsEnd,frameMs:elapsed*1000,substeps:world.steps-beforeSteps,rebuiltCords,uploadedBytes,drawCalls};
    frame=requestAnimationFrame(render);
  };
  // Read-only snapshots for reproducible browser verification.
  const debugCanvas=canvas as HTMLCanvasElement & { __patchboard?:()=>unknown;__patchboardTiming?:()=>unknown };
  debugCanvas.__patchboard=()=>({ ...world.diagnostics(),seed,layout:angle?{...layout}:null,timing:{...timing},grip:world.grip,sockets:world.sockets.map((p,i)=>({...project(p),hole:project(v(p.x,p.y,0.07)),position:{...p},occupied:world.occupied(i)})),cords:world.cords.map(c=>({ports:[...c.ports],length:c.rest.reduce((a,b)=>a+b,0),points:c.nodes.map(n=>({...n.p,screen:project(n.p)}))})) });
  debugCanvas.__patchboardTiming=()=>({...timing,rebuiltCords:[...timing.rebuiltCords]});
  frame=requestAnimationFrame(render);
  return {
    reset,
    view:setView,
    configure:(settings)=>{world.configure(settings);},
    dispose:()=>{
      disposed=true;cancelAnimationFrame(frame);observer.disconnect();overlay.remove();delete debugCanvas.__patchboard;delete debugCanvas.__patchboardTiming;
      document.removeEventListener("visibilitychange",visibility);
      canvas.removeEventListener("pointerdown",pointerDown);canvas.removeEventListener("pointermove",pointerMove);canvas.removeEventListener("pointerup",pointerUp);canvas.removeEventListener("pointercancel",pointerUp);canvas.removeEventListener("lostpointercapture",pointerUp);
      canvas.removeEventListener("wheel",wheel);canvas.removeEventListener("contextmenu",context);window.removeEventListener("keydown",key);window.removeEventListener("blur",cancel);
      for(const cached of meshCache.values())gl.deleteBuffer(cached.buffer);meshCache.clear();
      gl.deleteTexture(artwork);gl.deleteTexture(rubber);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    },
  };
}
