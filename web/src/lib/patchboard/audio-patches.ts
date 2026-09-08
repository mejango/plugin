export type AudioPatch = { a: { x:number; y:number }; b: { x:number; y:number } };
let patches:AudioPatch[]=[];
const listeners=new Set<()=>void>();
export const audioPatches=()=>patches;
export function publishAudioPatches(next:AudioPatch[]){patches=next;for(const listener of listeners)listener();}
export function subscribeAudioPatches(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
/** Bipolar control signals keep a full board responsive instead of saturating it. */
export function patchTone(connections:AudioPatch[]){
 if(!connections.length)return {cutoff:18000,resonance:.7,vibrato:0,tremolo:0,echo:0,drive:1,rate:.7,fmIndex:0,fmRatio:1,sweep:0,delay:.24};
 const signals=Array(11).fill(0) as number[];
 for(const {a,b} of connections){
  // Both ends contribute, so swapping a cable's direction preserves its tone.
  // Rows and columns affect every control, including moving within one column.
  for(let i=0;i<signals.length;i++){
   const k=i+1;
   const source=(p:{x:number;y:number})=>Math.sin(p.x*(1.31+k*.73)+p.y*(2.17+k*.41)*1.618);
   const left=source(a),right=source(b);
   signals[i]+=left+right+.5*left*right;
  }
 }
 // Periodic controls retain contrast even when many routes are connected.
 const controls=signals.map(n=>(1+Math.sin(n*1.7))/2);
 const [filter,resonance,pitch,amp,echo,drive,rate,fm,ratio,sweep,delay]=controls;
 return {cutoff:140*Math.pow(100,filter),resonance:.7+resonance*8,vibrato:pitch*480,tremolo:amp*.48,echo:echo*.45,drive:1+drive*17,rate:.2+rate*19,fmIndex:fm*5,fmRatio:[.5,1,2,3,5,7][Math.min(5,Math.floor(ratio*6))],sweep:sweep*2400,delay:.07+delay*.38};
}
export const NOTE_KEYS:Record<string,number>={KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17};
export const midiFrequency=(note:number)=>440*2**((note-69)/12);
