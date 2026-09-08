import {describe,it,expect} from 'vitest';
import {NOTE_KEYS,midiFrequency,patchTone} from '@/lib/patchboard/audio-patches';
describe('board synthesizer mapping',()=>{
 it('maps a chromatic keyboard to equal-tempered notes',()=>{
  expect(Object.values(NOTE_KEYS)).toEqual(Array.from({length:18},(_,i)=>i));
  expect(midiFrequency(69)).toBe(440);expect(midiFrequency(60)).toBeCloseTo(261.6256,3);
 });
 it('has an unmodulated baseline without cables',()=>{
  expect(patchTone([])).toMatchObject({cutoff:18000,resonance:.7,vibrato:0,tremolo:0,echo:0,drive:1,fmIndex:0,sweep:0});
 });
 it('responds to socket endpoints, independently of cable direction',()=>{
  const a={x:1.05,y:2},b={x:3.15,y:4};
  expect(patchTone([{a,b}])).toEqual(patchTone([{a:b,b:a}]));
  expect(patchTone([{a,b}])).not.toEqual(patchTone([{a,b:{...b,x:4.2}}]));
 });
 it('keeps individual repatches audible on a populated board',()=>{
  const patches=Array.from({length:18},(_,i)=>({a:{x:(i%12-5.5)*1.05,y:2+Math.floor(i/12)*1.05},b:{x:((i+5)%12-5.5)*1.05,y:5+Math.floor(i/12)*1.05}}));
  const before=patchTone(patches);
  const after=patchTone(patches.map((p,i)=>i===7?{...p,b:{...p.b,y:p.b.y+1.05}}:p));
  // A same-column move must change more than an inaudibly small parameter.
  const contrast=Math.max(Math.abs(Math.log2(after.cutoff/before.cutoff)),Math.abs(after.vibrato-before.vibrato)/100,Math.abs(after.rate-before.rate)/3);
  expect(contrast).toBeGreaterThan(.2);
  const variants=Array.from({length:12},(_,i)=>patchTone(patches.map((p,j)=>j===7?{...p,b:{...p.b,y:p.b.y+(i+1)*1.05}}:p)));
  expect(new Set(variants.map(t=>t.fmRatio)).size).toBeGreaterThan(2);
  expect(Math.max(...variants.map(t=>t.fmIndex))-Math.min(...variants.map(t=>t.fmIndex))).toBeGreaterThan(2);
 });
 it('keeps dense patches within bounded modulation levels',()=>{
  const tone=patchTone(Array.from({length:100},(_,i)=>({a:{x:i*1.05,y:2},b:{x:(i+3)*1.05,y:4}})));
  expect(tone.tremolo).toBeLessThanOrEqual(.48);expect(tone.vibrato).toBeLessThanOrEqual(480);expect(tone.echo).toBeLessThanOrEqual(.45);expect(tone.drive).toBeLessThanOrEqual(18);expect(tone.cutoff).toBeGreaterThanOrEqual(140);
  expect(tone.fmIndex).toBeLessThanOrEqual(5);expect(tone.sweep).toBeLessThanOrEqual(2400);expect(tone.delay).toBeLessThanOrEqual(.45);
 });
});
