type Point = { x: number; y: number };
/** Map a DOM rectangle onto four projected corners of the board plane. */
export function planeTransform(width: number, height: number, [p0,p1,p2,p3]: [Point,Point,Point,Point]) {
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  const det=dx1*dy2-dx2*dy1;
  const g=Math.abs(det)>1e-9?(dx3*dy2-dx2*dy3)/det:0;
  const h=Math.abs(det)>1e-9?(dx1*dy3-dx3*dy1)/det:0;
  return `matrix3d(${[(p1.x-p0.x+g*p1.x)/width,(p1.y-p0.y+g*p1.y)/width,0,g/width,(p3.x-p0.x+h*p3.x)/height,(p3.y-p0.y+h*p3.y)/height,0,h/height,0,0,1,0,p0.x,p0.y,0,1].join(",")})`;
}
