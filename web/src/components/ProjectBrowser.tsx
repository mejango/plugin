"use client";
import {useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {queryBendystraw} from '@/lib/bendystraw/client';
import {BendystrawOperations} from '@/lib/bendystraw/operations';
import {browserProjectIdentity} from '@/lib/juicebox-project';
import styles from './Workstation.module.css';
type Website = 'Juicebox'|'Revnet'|'Succulent';
export function ProjectBrowser({projectUrl}:{projectUrl:string}){
 const identity=browserProjectIdentity(projectUrl);
 const id=useId();
 const [tab,setTab]=useState<Website>('Juicebox');
 const [visited,setVisited]=useState<Website[]>(['Juicebox']);
 const [reload,setReload]=useState({Juicebox:0,Revnet:0,Succulent:0});
 const {data,isError,refetch}=useQuery({queryKey:['browser-project',projectUrl],enabled:!!identity,staleTime:300_000,retry:1,queryFn:()=>queryBendystraw<{project:{isRevnet:boolean|null}|null}>(BendystrawOperations.Project,{chainId:identity!.chainId,projectId:identity!.projectId})});
 const isRevnet=data?.project?.isRevnet===true;
 const websites:Website[]=isRevnet?['Juicebox','Revnet','Succulent']:['Juicebox','Succulent'];
 const active=websites.includes(tab)?tab:'Juicebox';
 const urls:Record<Website,string>={Juicebox:projectUrl,Revnet:identity?.revnetUrl??projectUrl,Succulent:projectUrl.replace('https://juicebox.money/','https://succulent.money/')};
 const activeUrl=urls[active];
 const select=(next:Website)=>{setTab(next);setVisited(current=>current.includes(next)?current:[...current,next]);};
 return <div className={styles.browser}>
  {isError&&<div role="status" className={styles.browserTabs}><span>Could not check project websites.</span><button type="button" onClick={()=>void refetch()}>Retry</button></div>}
  <div className={styles.browserTabs} role="tablist" aria-label="Project websites">
   {websites.map(name=><button key={name} type="button" role="tab" id={`${id}-${name}-tab`} aria-controls={`${id}-${name}-panel`} aria-selected={active===name} tabIndex={active===name?0:-1} onClick={()=>select(name)} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?websites[0]:event.key==='End'?websites[websites.length-1]:websites[(websites.indexOf(active)+(event.key==='ArrowRight'?1:websites.length-1))%websites.length];select(next);document.getElementById(`${id}-${next}-tab`)?.focus();
   }}>{name}</button>)}
  </div>
  <nav className={styles.browserBar} aria-label="Computer browser">
   <span title={activeUrl}>{activeUrl.replace('https://','')}</span>
   <button type="button" onClick={()=>setReload(n=>({...n,[active]:n[active]+1}))} aria-label={`Reload ${active}`}>↻</button>
   <a href={activeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${active} in a new tab`}>↗</a>
  </nav>
  {websites.map(name=>!visited.includes(name)?null:<div key={name} className={styles.browserPage} hidden={active!==name} role="tabpanel" id={`${id}-${name}-panel`} aria-labelledby={`${id}-${name}-tab`}>
   <iframe key={`${projectUrl}:${reload[name]}`} src={urls[name]} title={`${name} project`} allow="clipboard-write; payment; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
  </div>)}
 </div>;
}
