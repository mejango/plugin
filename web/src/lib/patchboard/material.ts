// One small, repeatable rubber-grain texture shared by all cords. Mipmaps
// average the grain at small sizes instead of making it sparkle while dragging.
export const RUBBER_TEXTURE_SIZE = 128;

export function rubberGrain() {
  const size=RUBBER_TEXTURE_SIZE,data=new Uint8Array(size*size*4);
  const noise=(x:number,y:number)=>{
    let h=Math.imul(x+37,374761393)^Math.imul(y+71,668265263);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967295;
  };
  const smooth=(t:number)=>t*t*(3-2*t);
  const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const cx=x>>3,cy=y>>3,u=smooth((x%8)/8),v=smooth((y%8)/8);
    const coarse=mix(mix(noise(cx,cy),noise((cx+1)%16,cy),u),mix(noise(cx,(cy+1)%16),noise((cx+1)%16,(cy+1)%16),u),v);
    const grain=Math.round(255*(0.55*coarse+0.45*noise(x+131,y+197)));
    const i=(y*size+x)*4;data[i]=grain;data[i+1]=grain;data[i+2]=grain;data[i+3]=255;
  }
  return data;
}
