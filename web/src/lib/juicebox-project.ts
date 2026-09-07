const SLUGS:Record<number,string>={1:'eth',10:'op',8453:'base',42161:'arb'};
export function projectBrowserPath(chainId?:number,projectId?:number){
 return chainId&&SLUGS[chainId]&&Number.isSafeInteger(projectId)&&projectId!>0?`/browse/${SLUGS[chainId]}/${projectId}`:null;
}
export function juiceboxProjectUrl(pathname:string){
 const match=/^\/browse\/(eth|op|base|arb)\/([1-9]\d*)$/.exec(pathname);
 return match&&Number.isSafeInteger(Number(match[2]))?`https://juicebox.money/${match[1]}:${match[2]}`:null;
}
