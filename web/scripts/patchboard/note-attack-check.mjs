import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../package.json',import.meta.url));
const ts=require('typescript');
const source=['audio-patches.ts','synth.ts'].map(file=>readFileSync(new URL(`../../src/lib/patchboard/${file}`,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
const {chromium}=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();
 const results=await page.evaluate(async compiled=>{
  const Synth=new Function(`${compiled}\nreturn BoardSynth;`)();
  const results=[];
  for(const delay of [.3,1.2]){
   const render=async second=>{
    const ctx=new OfflineAudioContext(1,96000,48000),synth=new Synth(ctx);
    synth.volume(1);synth.noteOn('a',60);
    let start=0;
    const paused=ctx.suspend(delay).then(()=>{
     start=Math.round(ctx.currentTime*ctx.sampleRate);
     if(second)synth.noteOn('s',64);
     void ctx.resume();
    });
    const audio=await ctx.startRendering();await paused;
    return {start,data:audio.getChannelData(0)};
   };
   const baseline=await render(false),chord=await render(true);
   // Subtract the held note: only the new voice should emerge, smoothly.
   const peak=(from,to)=>{let max=0;for(let i=from;i<to;i++)max=Math.max(max,Math.abs(chord.data[chord.start+i]-baseline.data[baseline.start+i]));return max;};
   // Account for the compressor's look-ahead latency before measuring onset.
   let onset=0;while(onset<2400&&peak(onset,onset+1)<.00001)onset++;
   results.push({delay,onset,firstMillisecond:peak(onset,onset+48),afterAttack:peak(onset+960,onset+1920)});
  }
  return results;
 },compiled);
 for(const result of results){
  assert(result.firstMillisecond<result.afterAttack*.1,`second note enters smoothly: ${JSON.stringify(result)}`);
  assert(result.afterAttack>.025,`second note reaches audible level: ${JSON.stringify(result)}`);
 }
 console.log('PASS: overlapping notes fade in smoothly at early and late context times.',JSON.stringify(results));
}finally{await browser.close();}
