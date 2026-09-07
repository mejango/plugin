import {describe,it,expect} from "vitest";
import {projectReadout,type StatsProject} from "@/lib/project-readout";
const project:StatsProject={projectId:1,chainId:1,name:"Test",tokenSymbol:"ETH",decimals:18,currency:"61166",balance:"1000000000000000000",volumeUsd:"2000000000000000000000",tokenSupply:"3000000000000000000000",paymentsCount:2,deployErc20Events:{items:[{symbol:"TEST"}]}};
const machine={id:"group",name:"Test",ticker:"TEST",balance:"",fullBalance:""};
describe("project terminal stats",()=>{
 it("aggregates across chains with explicit units",()=>{
  expect(projectReadout(machine,[project,{...project,chainId:10}]).rows).toEqual([
   {label:"BALANCE",value:"2 ETH"},{label:"RAISED",value:"$4,000"},{label:"PAYMENTS",value:"4"},{label:"TOKEN SUPPLY",value:"6,000"},{label:"CHAINS",value:"2"}
  ]);
 });
 it("does not present incomplete stats as zero",()=>{
  const rows=projectReadout(machine,[project,{...project,volumeUsd:null,tokenSupply:null,paymentsCount:null,decimals:null}]).rows;
  expect(rows.slice(0,4).every(row=>row.value==="—")).toBe(true);
 });
});
