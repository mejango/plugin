import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
const {chromium}=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 const page=await browser.newPage({viewport});
 let failDetail=true;
 const project=i=>({projectId:i+1,chainId:1,name:`Machine ${i+1}`,balance:'1000000000000000000',tokenSymbol:'ETH',decimals:18,currency:'61166',tokenSupply:'2000000000000000000',volumeUsd:'5000000000000000000000',paymentsCount:7,deployErc20Events:{items:[{symbol:`M${i+1}`}]}});
 await page.route('**/api/bendystraw/mainnet/query',async route=>{
  const {operation,variables}=route.request().postDataJSON();
  let data;
  if(operation==='SuckerGroup'){
   if(failDetail){failDetail=false;await route.fulfill({status:502,json:{errors:[{message:'Offline'}]}});return;}
   data={suckerGroup:{projects:{items:[project(Number(variables.id))]}}};
  }else if(operation==='LatestMachines')data={activityEvents:{totalCount:12345,items:[{id:'event',projectId:1,chainId:1,timestamp:Date.now()/1000,project:{name:'Machine 1',suckerGroupId:'0'},payEvent:{},cashOutTokensEvent:null,swapEvent:null,sendPayoutsEvent:null,rulesetQueuedEvent:null,projectCreateEvent:null,addToBalanceEvent:null}]}};
  else data={suckerGroups:{totalCount:14,items:Array.from({length:Math.min(6,14-(variables.offset??0))},(_,n)=>{const i=n+(variables.offset??0);return {id:String(i),projects:{items:[project(i)]}};})}};
  await route.fulfill({json:{data}});
 });
 await page.goto('http://localhost:3004',{waitUntil:'domcontentloaded'});
 await page.getByRole('status').filter({hasText:'14 machines'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('canvas')?.__patchboard);
 const selected=page.locator('tr[aria-selected="true"]');
 assert.match(await selected.innerText(),/Machine 1\b/);
 // Arrow keys work with ordinary page focus, without clicking the terminal first.
 await page.keyboard.press('ArrowDown');assert.match(await selected.innerText(),/Machine 2\b/);
 await page.keyboard.press('ArrowRight');await page.getByText('Stats unavailable. Press right to retry.').waitFor();
 await page.keyboard.press('ArrowRight');await page.getByText('RAISED: $5,000',{exact:true}).waitFor();
 await page.keyboard.press('ArrowLeft');assert.match(await selected.innerText(),/Machine 2\b/);
 for(let i=0;i<5;i++)await page.keyboard.press('ArrowDown');
 await page.getByRole('cell',{name:'Machine 7',exact:true}).waitFor();assert.match(await selected.innerText(),/Machine 7\b/);
 await page.keyboard.press('ArrowUp');await page.getByRole('cell',{name:'Machine 6',exact:true}).waitFor();assert.match(await selected.innerText(),/Machine 6\b/);
 await page.getByRole('button',{name:'Open selected project',exact:true}).click();await page.getByText('PAYMENTS: 7',{exact:true}).waitFor();
 await page.screenshot({path:`/tmp/terminal-detail-${viewport.width}.png`});
 await page.getByRole('button',{name:'Back to plug ins'}).click();assert.match(await selected.innerText(),/Machine 6\b/);
 await page.getByRole('slider',{name:'View mode'}).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 await page.getByRole('status').filter({hasText:'12345 events'}).waitFor();
 await page.getByRole('button',{name:'Open selected project',exact:true}).click();await page.getByText('RAISED: $5,000',{exact:true}).waitFor();
 for(const label of ['Previous row','Next row','Back to plug ins','Open selected project']){
  const box=await page.getByRole('button',{name:label,exact:true}).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=viewport.width&&box.y>=0&&box.y+box.height<=viewport.height);
 }
 await page.close();
 }
 console.log('PASS: desktop/mobile directional keys, automatic keyboard input, pagination, full totals, project stats, retry, back selection, latest activity, knob key isolation.');
}finally{await browser.close();}
