"use client";
import {useEffect} from 'react';
import {NOTE_KEYS,audioPatches,subscribeAudioPatches} from '@/lib/patchboard/audio-patches';
import {machineReadout,subscribeMachineReadout} from '@/lib/patchboard/readout';
import {BoardSynth} from '@/lib/patchboard/synth';
export function BoardAudio({active}:{active:boolean}){
 useEffect(()=>{
  if(!active)return;
  let synth:BoardSynth|null=null,octave=4,disposed=false;
  const held=new Set<string>();
  const silence=()=>{held.clear();synth?.close();synth=null;};
  const ignore=(event:KeyboardEvent)=>event.ctrlKey||event.metaKey||event.altKey||!!(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"],[role="slider"]:not([data-board-knob]),dialog');
  const down=(event:KeyboardEvent)=>{
   if(ignore(event)||event.repeat)return;
   if(event.code==='Escape'){silence();return;}
   if(event.code==='KeyZ'||event.code==='KeyX'){event.preventDefault();silence();octave=Math.max(1,Math.min(7,octave+(event.code==='KeyX'?1:-1)));return;}
   const semitone=NOTE_KEYS[event.code];if(semitone===undefined||held.has(event.code))return;
   event.preventDefault();held.add(event.code);
   try{
    if(!synth){
     synth=new BoardSynth(new AudioContext());
     synth.patch(audioPatches());synth.volume(machineReadout().volume??0);
    }
    const current=synth;
    void current.context.resume().then(()=>{if(!disposed&&held.has(event.code))current.noteOn(event.code,12*(octave+1)+semitone);}).catch(()=>held.delete(event.code));
   }catch{held.delete(event.code);}
  };
  const up=(event:KeyboardEvent)=>{held.delete(event.code);synth?.noteOff(event.code);};
  const visibility=()=>{if(document.hidden)silence();};
  const unpatch=subscribeAudioPatches(()=>synth?.patch(audioPatches()));
  const unvolume=subscribeMachineReadout(()=>{if(!document.hidden)synth?.volume(machineReadout().volume??0);});
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',silence);document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;unpatch();unvolume();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',silence);document.removeEventListener('visibilitychange',visibility);synth?.close();};
 },[active]);
 return null;
}
