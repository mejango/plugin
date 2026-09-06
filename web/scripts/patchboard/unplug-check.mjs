// Run with the app on :3004: node scripts/patchboard/unplug-check.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const root=[process.env.PLAYWRIGHT_CORE,`${homedir()}/.claude/skills/gstack/node_modules/playwright-core`].find(p=>p&&existsSync(`${p}/index.mjs`));
if(!root)throw new Error("Set PLAYWRIGHT_CORE to a playwright-core installation");
const { chromium }=await import(pathToFileURL(`${root}/index.mjs`).href);
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try{
  for(const [route,width,height,touch] of [["/",1440,1000,false],["/",390,844,true],["/patchboard-angle",1440,1000,false],["/patchboard",1440,1000,false]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:touch}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem("patchboard-feel-v1",JSON.stringify({socketResistance:0.6})));
    await page.goto(new URL(`${route}?seed=41`,process.env.PATCHBOARD_BASE_URL||"http://localhost:3004").href);
    await page.waitForFunction(()=>document.querySelector("canvas")?.__patchboard?.().sleeping,null,{timeout:30000});
    const state=()=>page.evaluate(()=>document.querySelector("canvas").__patchboard());
    const initial=await state(),ports=initial.cords.map(c=>c.ports);
    assert.equal("socketResistance" in initial.feel,false,"obsolete saved settings cannot delay release");
    if(route==="/patchboard")assert.equal(await page.getByRole("slider",{name:"Socket hold",exact:true}).count(),0);
    await page.evaluate(()=>{
      const canvas=document.querySelector("canvas");
      canvas.__unplugMoves=[];
      canvas.addEventListener("pointerdown",e=>{
        if(e.isTrusted)canvas.__unplugDown={pointerId:e.pointerId,pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY};
      });
      // This listener runs after the app's handler, in the same input event,
      // before a physics frame can hide a release-distance regression.
      canvas.addEventListener("pointermove",e=>{
        if(!e.isTrusted||!(e.buttons&1))return;
        const s=canvas.__patchboard();
        canvas.__unplugMoves.push({grip:s.grip,ports:s.cords.map(c=>c.ports),pointerType:e.pointerType});
      });
    });
    const assertSeated=async()=>{
      const s=await state();assert.equal(s.grip,null);assert.deepEqual(s.cords.map(c=>c.ports),ports);
      assert.deepEqual(s.cords,initial.cords,"a click or cancelled click must not wake or move cables");
    };
    const tip=initial.cords[0].points[0].screen,p={x:Math.round(tip.x),y:Math.round(tip.y)};
    await page.mouse.click(p.x+3,p.y);await assertSeated();
    await page.mouse.move(p.x,p.y);await page.mouse.down();
    await page.evaluate(()=>{
      const canvas=document.querySelector("canvas"),down=canvas.__unplugDown;
      canvas.dispatchEvent(new PointerEvent("pointermove",{...down,buttons:1,bubbles:true}));
      const other={...down,pointerId:down.pointerId+100,clientX:down.clientX+80,buttons:1,bubbles:true};
      for(const type of ["pointerdown","pointermove","pointerup"])canvas.dispatchEvent(new PointerEvent(type,other));
    });
    await assertSeated();
    await page.keyboard.press("Escape");await page.mouse.up();await assertSeated();
    for(const type of ["pointercancel","lostpointercapture"]){
      await page.mouse.down();
      await page.evaluate(type=>{
        const canvas=document.querySelector("canvas");
        canvas.dispatchEvent(new PointerEvent(type,{...canvas.__unplugDown,clientX:0,clientY:0,bubbles:true}));
      },type);
      await page.mouse.up();await assertSeated();
    }
    // Even a one-pixel drag must release, on both ends, while other sockets stay
    // attached. Reset between cases so every assertion starts from rest.
    for(const end of [0,1]){
      if(end){await page.locator("canvas").first().focus();await page.keyboard.press("r");await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping);}
      const s=await state(),index=end?s.cords[0].points.length-1:0;
      const at=s.cords[0].points[index].screen,x=Math.round(at.x),y=Math.round(at.y);
      await page.mouse.move(x,y);await page.mouse.down();
      await page.evaluate(()=>{document.querySelector("canvas").__unplugMoves=[];});
      await page.mouse.move(x+1,y);
      const first=await page.evaluate(()=>document.querySelector("canvas").__unplugMoves[0]);
      assert.equal(first?.grip?.cord,0,"first one-pixel mouse move immediately grabs the cord");
      assert.equal(first.grip.index,index);
      const expected=ports.map(p=>[...p]);expected[0][end]=null;
      assert.deepEqual(first.ports,expected,"only the selected plug disconnects");
      await page.waitForFunction(({index,x,y,z})=>{
        const s=document.querySelector("canvas").__patchboard(),point=s.cords[0].points[index];
        return Math.hypot(point.screen.x-x,point.screen.y-y)<1&&point.z>z;
      },{index,x:x+1,y,z:s.cords[0].points[index].z});
      await page.keyboard.press("Escape");await page.mouse.up();
    }
    for(const input of ["wheel","keyboard",...(touch?["touch"]:[])]){
      await page.locator("canvas").first().focus();await page.keyboard.press("r");
      await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().sleeping);
      const s=await state(),at=s.cords[0].points[0].screen,x=Math.round(at.x),y=Math.round(at.y);
      if(input==="touch"){
        const cdp=await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
        assert.equal((await state()).grip,null);
        await page.evaluate(()=>{document.querySelector("canvas").__unplugMoves=[];});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+1,y,id:1}]});
        const first=await page.evaluate(()=>document.querySelector("canvas").__unplugMoves[0]);
        assert.equal(first?.pointerType,"touch");assert.equal(first?.grip?.cord,0,"first touch move releases immediately");
        await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await cdp.detach();
      }else{
        await page.mouse.move(x,y);await page.mouse.down();
        if(input==="wheel"){
          await page.evaluate(()=>document.querySelector("canvas").dispatchEvent(new WheelEvent("wheel",{deltaY:0,bubbles:true,cancelable:true})));
          assert.equal((await state()).grip,null,"zero wheel movement leaves the plug seated");
          await page.mouse.wheel(0,-1);
        }else await page.keyboard.press("ArrowUp");
        await page.waitForFunction(()=>document.querySelector("canvas").__patchboard().grip?.cord===0);
        assert.equal((await state()).cords[0].ports[0],null,`${input} depth movement releases without a threshold`);
        await page.keyboard.press("Escape");await page.mouse.up();
      }
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS: ${route} ${width}×${height}: immediate unplug, click/cancel safety, pointer ownership, depth controls${touch?", touch":""}`);
    await page.close();
  }
}finally{await browser.close();}
