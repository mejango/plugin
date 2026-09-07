export type AudioPatch = { a: { x:number; y:number }; b: { x:number; y:number } };
let patches:AudioPatch[]=[];
const listeners=new Set<()=>void>();
export const audioPatches=()=>patches;
export function publishAudioPatches(next:AudioPatch[]){patches=next;for(const listener of listeners)listener();}
export function subscribeAudioPatches(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
/** Each seated cable supplies modulation from its row to its column's circuit. */
export function patchTone(connections:AudioPatch[]){
 const amounts=[0,0,0,0,0,0];let rate=0;
 for(const {a,b} of connections){
  for(const [source,target] of [[a,b],[b,a]]){
   const circuit=((Math.round(target.x/1.05)+100)%6+6)%6;
   const amount=(1+Math.abs(Math.sin(source.y*1.7+source.x*.9)))*.5;
   amounts[circuit]+=amount;
   rate+=Math.abs(source.x-target.x)*.07+Math.abs(source.y-target.y)*.03;
  }
 }
 const bounded=amounts.map(n=>1-Math.exp(-n*.4));
 return {cutoff:18000*Math.pow(.07,bounded[0]),resonance:.7+bounded[1]*7,vibrato:bounded[2]*45,tremolo:bounded[3]*.35,echo:bounded[4]*.3,drive:1+bounded[5]*3,rate:.7+rate%6};
}
export const NOTE_KEYS:Record<string,number>={KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17};
export const midiFrequency=(note:number)=>440*2**((note-69)/12);
