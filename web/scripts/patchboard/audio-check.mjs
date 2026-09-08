import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
const {chromium}=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>{
  window.__audio=[];
  const Original=window.AudioContext;
  window.AudioContext=class extends Original{
   constructor(...args){super(...args);const record={ctx:this,osc:[],filters:[],gains:[],curveWrites:0,analyser:this.createAnalyser()};window.__audio.push(record);this.record=record;}
   createOscillator(){const osc=super.createOscillator();this.record?.osc.push(osc);return osc;}
   createBiquadFilter(){const filter=super.createBiquadFilter();this.record?.filters.push(filter);return filter;}
   createGain(){const gain=super.createGain();this.record?.gains.push(gain);return gain;}
  };
  const curve=Object.getOwnPropertyDescriptor(WaveShaperNode.prototype,'curve');
  Object.defineProperty(WaveShaperNode.prototype,'curve',{...curve,set(value){if(this.context.record)this.context.record.curveWrites++;curve.set.call(this,value);}});
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(target,...args){if(target===this.context.destination&&this.context.record)connect.call(this,this.context.record.analyser);return connect.call(this,target,...args);};
 });
 await page.goto('http://localhost:3004/?seed=123',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.__patchboard);
 assert.equal(await page.evaluate(()=>window.__audio.length),0,'no audio context before playing');
 const rms=()=>page.evaluate(()=>{const r=window.__audio.at(-1),samples=new Float32Array(r.analyser.fftSize);r.analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length);});
 await page.keyboard.down('a');await page.waitForTimeout(250);assert.equal(await rms(),0,'volume defaults to silence');
 const volume=page.getByRole('slider',{name:'Volume'});await volume.focus();await page.keyboard.press('End');await page.waitForTimeout(250);
 assert(await rms()>.001,'volume knob controls audible output');
 await page.keyboard.up('a');await page.waitForTimeout(600);assert(await rms()<.00001,'release ends sound including echo');
 // Finishing a physical dial drag must leave musical keys playable without
 // blurring it; its arrow-key adjustment still retains keyboard focus.
 const dial=await volume.boundingBox();
 await page.mouse.move(dial.x+dial.width/2,dial.y+dial.height/2);await page.mouse.down();
 await page.mouse.move(dial.x+dial.width/2,dial.y+dial.height/2+20,{steps:8});await page.mouse.up();
 assert(await volume.evaluate(el=>el===document.activeElement),'dial retains focus after dragging');
 const adjusted=Number(await volume.getAttribute('aria-valuenow'));
 await page.keyboard.press('ArrowUp');
 assert(Number(await volume.getAttribute('aria-valuenow'))>adjusted,'arrow keys still adjust the focused dial');
 const curveWrites=await page.evaluate(()=>window.__audio.at(-1).curveWrites);
 const framing=await page.locator('[data-board-terminal]').evaluate(el=>el.style.transform);
 await page.keyboard.down('f');await page.keyboard.down('g');await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.__audio.at(-1).curveWrites),curveWrites,'adding chord notes does not reset the shared distortion curve');
 assert.equal(await page.locator('[data-board-terminal]').evaluate(el=>el.style.transform),framing,'musical F no longer changes camera');
 assert(await rms()>.001,'chords sound immediately after a dial drag, without clicking away');
 if(!process.argv.includes('--notes-only')){
 await page.waitForTimeout(500);
 const portsBefore=await page.evaluate(()=>document.querySelector('canvas').__patchboard().cords.map(c=>c.ports));
 const patchBefore=await page.evaluate(()=>window.__audio.at(-1).gains.map(g=>g.gain.value));
 const tip=await page.evaluate(()=>document.querySelector('canvas').__patchboard().cords[0].points.at(-1).screen);
 await page.mouse.move(tip.x,tip.y);await page.mouse.down();await page.mouse.move(tip.x+55,tip.y+50,{steps:12});await page.mouse.up();await page.waitForTimeout(200);
 const patchAfter=await page.evaluate(()=>window.__audio.at(-1).gains.map(g=>g.gain.value));
 assert.notDeepEqual(patchAfter,patchBefore,'physical unplug changes sound modulation');
 const reconnect=await page.evaluate(before=>{
  const board=document.querySelector('canvas').__patchboard();
  for(let ci=0;ci<board.cords.length;ci++)for(let end=0;end<2;end++){
   if(before[ci][end]===null||board.cords[ci].ports[end]!==null)continue;
   const tip=board.cords[ci].points[end===0?0:board.cords[ci].points.length-1].screen;
   const target=board.sockets.map((s,i)=>({...s,i})).filter(s=>!s.occupied&&s.i!==before[ci][end]).sort((a,b)=>Math.hypot(a.hole.x-tip.x,a.hole.y-tip.y)-Math.hypot(b.hole.x-tip.x,b.hole.y-tip.y))[0];
   return {ci,end,tip,target};
  }
 },portsBefore);
 assert(reconnect,'a seated connection was physically unplugged');
 await page.mouse.move(reconnect.tip.x,reconnect.tip.y);await page.mouse.down();
 await page.mouse.move(reconnect.target.hole.x,reconnect.target.hole.y,{steps:20});await page.mouse.up();
 await page.waitForFunction(({ci,end,target})=>document.querySelector('canvas').__patchboard().cords[ci].ports[end]===target.i,reconnect,{timeout:10000});
 await page.waitForTimeout(300);
 const reconnected=await page.evaluate(()=>window.__audio.at(-1).gains.map(g=>g.gain.value));
 assert.notDeepEqual(reconnected,patchBefore,'moving to a different socket changes the sustained sound');
 assert(await rms()>.0001,'sustained notes remain audible after repatching');
 }

 await page.keyboard.up('f');await page.keyboard.up('g');
 await page.keyboard.down('a');await page.waitForTimeout(100);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.__audio.at(-1).ctx.state),'closed','blur shuts down all audio');await page.keyboard.up('a');
 await page.keyboard.down('a');await page.waitForTimeout(100);
 await page.getByRole('link',{name:'Create a new machine'}).click();await page.waitForURL('**/create');
 await page.waitForFunction(()=>window.__audio.at(-1).ctx.state==='closed');
 assert.equal(await page.evaluate(()=>window.__audio.at(-1).ctx.state),'closed','leaving board stops audio');await page.keyboard.up('a');
 const count=await page.evaluate(()=>window.__audio.length);await page.locator('#name').fill('ASDF keyboard typing');assert.equal(await page.evaluate(()=>window.__audio.length),count,'form typing stays silent');
 console.log(process.argv.includes('--notes-only')?'PASS: keyboard overlap without effect resets, focused dial, volume, note release, and audio cleanup.':'PASS: lazy audio, zero-volume silence, audible sine notes/chords, output volume, note release, patch modulation, blur cleanup, route cleanup, and silent form typing.');
}finally{await browser.close();}
