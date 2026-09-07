import {describe,it,expect} from 'vitest';
import {juiceboxProjectUrl,projectBrowserPath} from '@/lib/juicebox-project';
describe('Juicebox monitor addresses',()=>{
 it.each([[1,'eth'],[10,'op'],[8453,'base'],[42161,'arb']] as const)('uses the current V6 route for chain %s',(chain,slug)=>{
  const path=projectBrowserPath(chain,7);expect(path).toBe(`/browse/${slug}/7`);expect(juiceboxProjectUrl(path!)).toBe(`https://juicebox.money/${slug}:7`);
 });
 it('rejects unknown chains, malformed ids, and arbitrary sites',()=>{
  expect(projectBrowserPath(999,7)).toBeNull();expect(projectBrowserPath(1,0)).toBeNull();expect(projectBrowserPath(1,1.5)).toBeNull();
  for(const path of ['/browse/eth/0','/browse/eth/9007199254740992','/browse/evil/7','https://evil.test','/browse/eth/7?redirect=https://evil.test'])expect(juiceboxProjectUrl(path)).toBeNull();
 });
});
