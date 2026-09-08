// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SignIn } from '@/components/SignIn';
import { MachineManual } from '@/components/create/MachineManual';
const mocks=vi.hoisted(()=>({disconnect:vi.fn(),open:vi.fn(),logout:vi.fn(),live:vi.fn(),copy:vi.fn()}));
vi.mock('wagmi',()=>({useAccount:()=>({isConnected:true,address:'0x1111111111111111111111111111111111111111'}),useConfig:()=>({}),useConnectors:()=>[],useConnect:()=>({connect:vi.fn()}),useDisconnect:()=>({disconnectAsync:mocks.disconnect})}));
vi.mock('@wagmi/core',()=>({getConnections:()=>[]}));
vi.mock('@/hooks/useIsHydrated',()=>({useIsHydrated:()=>true}));
vi.mock('@/providers/ParaAuthContext',()=>({useParaAuth:()=>({enabled:true,requestSignIn:mocks.open}),markParaSession:vi.fn()}));
vi.mock('@/providers/para-config',()=>({getParaClient:()=>({isFullyLoggedIn:mocks.live,logout:mocks.logout})}));
vi.mock('@/providers/preload-para',()=>({preloadParaHost:vi.fn()}));
let root:Root,container:HTMLDivElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.resetAllMocks();
 mocks.live.mockResolvedValue(true);mocks.logout.mockResolvedValue(undefined);mocks.disconnect.mockResolvedValue(undefined);
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:mocks.copy}});
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
it('ends the old wallet session before opening a new sign-in',async()=>{
 await act(async()=>root.render(createElement(SignIn,{switchWallet:true,label:'alice.eth'})));
 const button=container.querySelector('button')!;
 expect(button.getAttribute('aria-label')).toContain('Change wallet');
 expect(button.textContent).toBe('alice.eth');
 await act(async()=>{button.click();await vi.dynamicImportSettled();});
 expect(mocks.logout).toHaveBeenCalledOnce();expect(mocks.disconnect).toHaveBeenCalledOnce();expect(mocks.open).toHaveBeenCalledOnce();
 expect(mocks.logout.mock.invocationCallOrder[0]).toBeLessThan(mocks.disconnect.mock.invocationCallOrder[0]);
 expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(mocks.open.mock.invocationCallOrder[0]);
});
it('keeps the current wallet if logout fails and reports the failure',async()=>{
 mocks.logout.mockRejectedValue(new Error('offline'));
 await act(async()=>root.render(createElement(SignIn,{switchWallet:true})));
 await act(async()=>{container.querySelector('button')!.click();await vi.dynamicImportSettled();});
 expect(mocks.open).not.toHaveBeenCalled();expect(mocks.disconnect).not.toHaveBeenCalled();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('try again');
});
it('prevents wallet switching while deployment is busy',async()=>{
 await act(async()=>root.render(createElement(SignIn,{switchWallet:true,disabled:true})));
 expect(container.querySelector('button')!.disabled).toBe(true);
});
it('keeps the finalized manual selectable and copyable while edits are locked',async()=>{
 const value='Custom instructions\nDEPLOYED PROJECT REFERENCES\nBase (chain ID 8453): project ID 27.';
 await act(async()=>root.render(createElement(MachineManual,{generated:'draft',value,dirty:true,readOnly:true,onChange:vi.fn(),onReset:vi.fn()})));
 expect(container.querySelector('textarea')!.readOnly).toBe(true);
 expect(container.querySelector('textarea')!.disabled).toBe(false);
 expect(container.querySelectorAll('button')).toHaveLength(1);
 await act(async()=>container.querySelector('button')!.click());
 expect(mocks.copy).toHaveBeenCalledWith(value);
});
