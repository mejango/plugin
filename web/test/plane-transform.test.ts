import {describe,it,expect} from "vitest";
import {planeTransform} from "@/lib/patchboard/plane-transform";
describe("board control projection",()=>{
 it.each([
  [{x:10,y:20},{x:110,y:20},{x:110,y:70},{x:10,y:70}],
  [{x:20,y:30},{x:180,y:10},{x:150,y:100},{x:40,y:90}],
 ])("maps every corner to the projected board",(...corners)=>{
  const values=planeTransform(100,50,corners as [typeof corners[0],typeof corners[0],typeof corners[0],typeof corners[0]]).slice(9,-1).split(",").map(Number);
  for(const [i,[x,y]] of [[0,0],[100,0],[100,50],[0,50]].entries()){
   const w=values[3]*x+values[7]*y+values[15];
   expect((values[0]*x+values[4]*y+values[12])/w).toBeCloseTo(corners[i].x);
   expect((values[1]*x+values[5]*y+values[13])/w).toBeCloseTo(corners[i].y);
  }
 });
});
