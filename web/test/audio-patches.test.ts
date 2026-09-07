import {describe,it,expect} from 'vitest';
import {NOTE_KEYS,midiFrequency,patchTone} from '@/lib/patchboard/audio-patches';
describe('board synthesizer mapping',()=>{
 it('maps a chromatic keyboard to equal-tempered notes',()=>{
  expect(Object.values(NOTE_KEYS)).toEqual(Array.from({length:18},(_,i)=>i));
  expect(midiFrequency(69)).toBe(440);expect(midiFrequency(60)).toBeCloseTo(261.6256,3);
 });
 it('has an unmodulated baseline without cables',()=>{
  expect(patchTone([])).toMatchObject({cutoff:18000,resonance:.7,vibrato:0,tremolo:0,echo:0,drive:1});
 });
 it('responds to socket endpoints, independently of cable direction',()=>{
  const a={x:1.05,y:2},b={x:3.15,y:4};
  expect(patchTone([{a,b}])).toEqual(patchTone([{a:b,b:a}]));
  expect(patchTone([{a,b}])).not.toEqual(patchTone([{a,b:{...b,x:4.2}}]));
 });
 it('keeps dense patches within bounded modulation levels',()=>{
  const tone=patchTone(Array.from({length:100},(_,i)=>({a:{x:i*1.05,y:2},b:{x:(i+3)*1.05,y:4}})));
  expect(tone.tremolo).toBeLessThanOrEqual(.35);expect(tone.vibrato).toBeLessThanOrEqual(45);expect(tone.echo).toBeLessThanOrEqual(.3);expect(tone.drive).toBeLessThanOrEqual(4);expect(tone.cutoff).toBeGreaterThan(1000);
 });
});
