export type V3 = { x: number; y: number; z: number };
export const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: V3, s: number) => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: V3) => Math.sqrt(dot(a, a));
export const distance = (a: V3, b: V3) => Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2);
export const unit = (a: V3) => mul(a, 1 / (length(a) || 1));
export const cross = (a: V3, b: V3) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lerp = (a: V3, b: V3, t: number) => v(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function move(a: V3, d: V3, s = 1) { a.x += d.x * s; a.y += d.y * s; a.z += d.z * s; }

// Closest points on finite segments, including parallel and degenerate cases.
export function closest(a: V3, b: V3, c: V3, d: V3) {
  const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
  const wx=d.x-c.x,wy=d.y-c.y,wz=d.z-c.z;
  const rx=a.x-c.x,ry=a.y-c.y,rz=a.z-c.z;
  const aa=ux*ux+uy*uy+uz*uz,ee=wx*wx+wy*wy+wz*wz,f=wx*rx+wy*ry+wz*rz;
  let s = 0, t = 0;
  if (aa < 1e-12) t = ee < 1e-12 ? 0 : clamp(f / ee, 0, 1);
  else {
    const cc = ux*rx+uy*ry+uz*rz;
    if (ee < 1e-12) s = clamp(-cc / aa, 0, 1);
    else {
      const bb = ux*wx+uy*wy+uz*wz, den = aa * ee - bb * bb;
      s = den > 1e-12 ? clamp((bb * f - cc * ee) / den, 0, 1) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) { t = 0; s = clamp(-cc / aa, 0, 1); }
      if (t > 1) { t = 1; s = clamp((bb - cc) / aa, 0, 1); }
    }
  }
  const p = lerp(a, b, s), q = lerp(c, d, t);
  return { s, t, p, q, distance: distance(p, q) };
}
