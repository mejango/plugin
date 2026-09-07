import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error('Set PLAYWRIGHT_CORE to a playwright-core installation');
const {chromium}=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://localhost:3004',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('canvas')?.__patchboard);
  const mode=page.getByRole('slider',{name:'View mode'}),volume=page.getByRole('slider',{name:'Volume'});
  const value=async knob=>Number(await knob.getAttribute('aria-valuenow'));
  const drag=async(knob,dx,dy)=>{
    const b=await knob.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();
  };
  assert.equal(await value(volume),0);
  await drag(mode,50,0);assert.equal(await value(mode),1,'drag snaps once without a trailing click');
  await drag(mode,50,0);assert.equal(await value(mode),2);
  await drag(mode,50,0);assert.equal(await value(mode),3);
  await drag(mode,-150,0);assert.equal(await value(mode),0);
  await drag(volume,37,0);const continuous=await value(volume);
  assert.ok(continuous>.24&&continuous<.25,'volume supports values between detents');
  await volume.press('End');assert.equal(await value(volume),1);
  await volume.press('ArrowLeft');assert.equal(await value(volume),.99);
  await page.getByRole('link',{name:'Create a new machine'}).click();await page.waitForURL('**/create');
  await page.getByRole('link',{name:'← Board',exact:true}).click();await page.waitForURL('http://localhost:3004/');
  assert.equal(await value(volume),.99,'volume survives workstation navigation');
  await volume.press('Home');assert.equal(await value(volume),0);
  console.log('PASS: four mode detents, continuous volume, pointer capture, keyboard and navigation retention.');
} finally {await browser.close();}
