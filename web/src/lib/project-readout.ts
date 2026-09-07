import { formatUnits } from "viem";
import { trendingMachines, type TrendingProject, type TrendingMachine } from "./trending-machines";
export type StatsProject = TrendingProject & { tokenSupply: string | null; volumeUsd: string | null; paymentsCount: number | null };
export type ProjectStatsData = { suckerGroup: { projects: { items: StatsProject[] } } | null };
const compact=(n:number)=>new Intl.NumberFormat("en-US",{notation:n>=10000?"compact":"standard",maximumFractionDigits:2}).format(n);
export function projectReadout(machine:TrendingMachine,projects:StatsProject[]) {
  const balance=trendingMachines({suckerGroups:{items:[{id:machine.id,projects:{items:projects}}]}})[0]?.balance??"—";
  const sum=(field:"volumeUsd"|"tokenSupply")=>projects.length&&projects.every(p=>p[field]!==null&&/^\d+$/.test(p[field]!))?compact(Number(formatUnits(projects.reduce((n,p)=>n+BigInt(p[field]!),0n),18))):"—";
  const raised=sum("volumeUsd");
  return {name:machine.name,rows:[
    {label:"BALANCE",value:balance},
    {label:"RAISED",value:raised==="—"?raised:`$${raised}`},
    {label:"PAYMENTS",value:projects.every(p=>p.paymentsCount!==null)?projects.reduce((n,p)=>n+p.paymentsCount!,0).toLocaleString("en-US"):"—"},
    {label:"TOKEN SUPPLY",value:sum("tokenSupply")},
    {label:"CHAINS",value:String(new Set(projects.map(p=>p.chainId)).size)},
  ]};
}
