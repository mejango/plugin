import {midiFrequency,patchTone,type AudioPatch} from './audio-patches';
type Voice={osc:OscillatorNode;gain:GainNode;mod:OscillatorNode;fm:GainNode;frequency:number};
/** A sine voice with a normalled audio path and cable-controlled modulation. */
export class BoardSynth {
 private readonly curve=Float32Array.from({length:1024},(_,i)=>Math.tanh((i/1023*2-1)*1.5)/Math.tanh(1.5));
 private voices=new Map<string,Voice>();
 private filter:BiquadFilterNode;
 private preamp:GainNode;
 private shaper:WaveShaperNode;
 private tremolo:GainNode;
 private level:GainNode;
 private lfo:OscillatorNode;
 private pitchMod:GainNode;
 private ampMod:GainNode;
 private filterMod:GainNode;
 private tone=patchTone([]);
 private delay:DelayNode;
 private wet:GainNode;
 private master:GainNode;
 private limiter:DynamicsCompressorNode;
 constructor(readonly context:AudioContext){
  this.filter=context.createBiquadFilter();this.filter.type='lowpass';
  this.preamp=context.createGain();this.shaper=context.createWaveShaper();this.level=context.createGain();
  this.shaper.curve=null;
  this.tremolo=context.createGain();this.delay=context.createDelay(1);this.delay.delayTime.value=.24;
  this.wet=context.createGain();this.master=context.createGain();this.master.gain.value=0;
  this.limiter=context.createDynamicsCompressor();this.limiter.threshold.value=-12;this.limiter.knee.value=6;this.limiter.ratio.value=12;this.limiter.attack.value=.003;this.limiter.release.value=.15;
  this.preamp.connect(this.shaper).connect(this.level).connect(this.filter).connect(this.tremolo);
  this.tremolo.connect(this.limiter);this.tremolo.connect(this.delay).connect(this.wet).connect(this.limiter);
  this.limiter.connect(this.master).connect(context.destination);
  this.lfo=context.createOscillator();this.lfo.type='sine';this.pitchMod=context.createGain();this.ampMod=context.createGain();
  this.filterMod=context.createGain();this.lfo.connect(this.filterMod).connect(this.filter.detune);
  this.lfo.connect(this.pitchMod);this.lfo.connect(this.ampMod).connect(this.tremolo.gain);this.lfo.start();
  this.patch([]);
 }
 private smooth(param:AudioParam,value:number){param.setTargetAtTime(value,this.context.currentTime,.035);}
 volume(value:number){this.smooth(this.master.gain,Math.max(0,Math.min(1,value))**2*.65);}
 patch(patches:AudioPatch[]){
  const tone=this.tone=patchTone(patches);
  for(const voice of this.voices.values())this.modulate(voice);
  this.smooth(this.filterMod.gain,tone.sweep);this.smooth(this.delay.delayTime,tone.delay);
  this.shaper.curve=patches.length?this.curve:null;
  this.smooth(this.filter.frequency,tone.cutoff);this.smooth(this.filter.Q,tone.resonance);
  this.smooth(this.level.gain,1/Math.sqrt(tone.drive));
  this.smooth(this.preamp.gain,tone.drive);this.smooth(this.pitchMod.gain,tone.vibrato);
  this.smooth(this.ampMod.gain,tone.tremolo);this.smooth(this.tremolo.gain,1-tone.tremolo);
  this.smooth(this.wet.gain,tone.echo);this.smooth(this.lfo.frequency,tone.rate);
 }
 private modulate(voice:Voice){
  this.smooth(voice.mod.frequency,voice.frequency*this.tone.fmRatio);
  this.smooth(voice.fm.gain,voice.frequency*this.tone.fmIndex);
 }
 noteOn(key:string,note:number){
  if(this.voices.has(key)||this.context.state==='closed')return;
  if(this.voices.size>=8)this.noteOff(this.voices.keys().next().value!);
  const osc=this.context.createOscillator(),gain=this.context.createGain(),now=this.context.currentTime;
  const frequency=midiFrequency(note),mod=this.context.createOscillator(),fm=this.context.createGain();
  mod.type='sine';mod.frequency.value=frequency*this.tone.fmRatio;fm.gain.value=frequency*this.tone.fmIndex;
  mod.connect(fm).connect(osc.frequency);
  osc.type='sine';osc.frequency.value=frequency;
  // Anchor the attack at this note's start, not at AudioContext time zero.
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.09,now+.025);
  osc.connect(gain).connect(this.preamp);this.pitchMod.connect(osc.detune);osc.start(now);mod.start(now);
  this.voices.set(key,{osc,gain,mod,fm,frequency});
 }
 noteOff(key:string){
  const voice=this.voices.get(key);if(!voice)return;this.voices.delete(key);
  const now=this.context.currentTime;
  voice.gain.gain.cancelAndHoldAtTime(now);voice.gain.gain.linearRampToValueAtTime(0,now+.09);voice.osc.stop(now+.1);voice.mod.stop(now+.1);
  voice.osc.onended=()=>{this.pitchMod.disconnect(voice.osc.detune);voice.osc.disconnect();voice.gain.disconnect();voice.mod.disconnect();voice.fm.disconnect();};
 }
 silence(){for(const key of this.voices.keys())this.noteOff(key);this.master.gain.cancelScheduledValues(this.context.currentTime);this.master.gain.setTargetAtTime(0,this.context.currentTime,.01);}
 close(){this.silence();this.lfo.stop();void this.context.close();}
}
