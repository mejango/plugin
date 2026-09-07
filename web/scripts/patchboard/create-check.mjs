import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root = [process.env.PLAYWRIGHT_CORE, `${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(path => path && existsSync(`${path}/index.mjs`));
if (!root) throw new Error('Set PLAYWRIGHT_CORE to a playwright-core installation');
const { chromium } = await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>console.log('ERROR',error.stack));
await page.goto('http://localhost:3004/create',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('canvas')?.__patchboard);
await page.getByRole('heading',{name:'Identity',exact:true}).waitFor();

const next=()=>page.getByRole('button',{name:/NEXT/}).click();
for (const title of ['Goal', 'Issuance', 'Splits', 'How it works', 'Manual', 'Launch']) {
  await next();
  await page.getByRole('heading', { name: title, level: 1, exact: true }).waitFor();
}
assert.equal(await page.locator('form').getByRole('alert').count(), 0, 'empty drafts can preview every page');
await page.getByRole('combobox', { name: 'Creation page' }).selectOption('0');
await page.locator('#name').fill('Foraging Bot');await page.locator('#symbol').fill('FORAGE');await page.locator('#machine-address').fill('0x1111111111111111111111111111111111111111');
await next();await page.getByRole('heading',{name:'Goal',exact:true}).waitFor();
await page.locator('#goal').fill('Find good food for the neighborhood.');
await page.getByRole('button',{name:'Bold',exact:true}).click();
assert.ok((await page.locator('#goal').inputValue()).includes('**'));

await next();await page.getByRole('button',{name:'Weekly',exact:true}).click();

await next();await page.locator('#cut').selectOption('50');
await page.getByLabel('Percent of the keep routed to Revnet').fill('20');
await page.getByLabel('Lock forever').check();

await next();
await next();await page.locator('#manual').fill('My custom machine manual.');
await next();await page.getByRole('heading',{name:'Launch',exact:true}).waitFor();

await page.getByRole('button',{name:/full form/i}).click();
assert.equal(await page.locator('#name').inputValue(),'Foraging Bot');
assert.equal(await page.locator('#manual').inputValue(),'My custom machine manual.');
await page.getByRole('button',{name:'Screen view',exact:true}).click();
await page.getByRole('combobox',{name:'Creation page'}).selectOption('0');
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1000);

assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
console.log('PASS: all seven steps, validation, formatting, issuance, splits, manual, full-form retention, mobile. No deployment submitted.');
} finally {await browser.close();}
