import { describe, expect, it } from "vitest";
import { rubberGrain, RUBBER_TEXTURE_SIZE } from "../src/lib/patchboard/material";

describe("rubber surface grain",()=>{
  it("uses a small, repeatable power-of-two texture suitable for WebGL mipmaps",()=>{
    expect(RUBBER_TEXTURE_SIZE&(RUBBER_TEXTURE_SIZE-1)).toBe(0);
    const data=rubberGrain();
    expect(data.byteLength).toBe(64*1024);
    expect(data.length).toBe(RUBBER_TEXTURE_SIZE**2*4);
    expect(rubberGrain()).toEqual(data);
  });
  it("adds neutral grain without changing the cable's color or opacity",()=>{
    const data=rubberGrain(),values=[];
    for(let i=0;i<data.length;i+=4){
      if(data[i]!==data[i+1]||data[i]!==data[i+2]||data[i+3]!==255)throw new Error("Grain must be opaque grayscale");
      values.push(data[i]);
    }
    expect(new Set(values).size).toBeGreaterThan(150);
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    expect(mean).toBeGreaterThan(118);expect(mean).toBeLessThan(137);
  });
});
