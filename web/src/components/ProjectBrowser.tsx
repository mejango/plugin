"use client";
import {useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {queryBendystraw} from '@/lib/bendystraw/client';
import {BendystrawOperations} from '@/lib/bendystraw/operations';
import {browserProjectIdentity} from '@/lib/juicebox-project';
import styles from './Workstation.module.css';
export function ProjectBrowser({projectUrl}:{projectUrl:string}){
 const identity=browserProjectIdentity(projectUrl);
 const id=useId();
 const [tab,setTab]=useState<'Juicebox'|'Revnet'>('Juicebox');
 const [visitedRevnet,setVisitedRevnet]=useState(false);
 const [reload,setReload]=useState({Juicebox:0,Revnet:0});
 const {data,isError,refetch}=useQuery({queryKey:['browser-project',projectUrl],enabled:!!identity,staleTime:300_000,retry:1,queryFn:()=>queryBendystraw<{project:{isRevnet:boolean|null}|null}>(BendystrawOperations.Project,{chainId:identity!.chainId,projectId:identity!.projectId})});
 const isRevnet=data?.project?.isRevnet===true;
 const active=isRevnet?tab:'Juicebox';
 const activeUrl=active==='Revnet'?identity!.revnetUrl:projectUrl;
 const select=(next:'Juicebox'|'Revnet')=>{setTab(next);if(next==='Revnet')setVisitedRevnet(true);};
 return <div className={styles.browser}>
  {isError&&<div role="status" className={styles.browserTabs}><span>Could not check project websites.</span><button type="button" onClick={()=>void refetch()}>Retry</button></div>}
  {isRevnet&&<div className={styles.browserTabs} role="tablist" aria-label="Project websites">
   {(['Juicebox','Revnet'] as const).map(name=><button key={name} type="button" role="tab" id={`${id}-${name}-tab`} aria-controls={`${id}-${name}-panel`} aria-selected={active===name} tabIndex={active===name?0:-1} onClick={()=>select(name)} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?'Juicebox':event.key==='End'?'Revnet':active==='Juicebox'?'Revnet':'Juicebox';select(next);document.getElementById(`${id}-${next}-tab`)?.focus();
   }}>{name}</button>)}
  </div>}
  <nav className={styles.browserBar} aria-label="Computer browser">
   <span title={activeUrl}>{activeUrl.replace('https://','')}</span>
   <button type="button" onClick={()=>setReload(n=>({...n,[active]:n[active]+1}))} aria-label={`Reload ${active}`}>↻</button>
   <a href={activeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${active} in a new tab`}>↗</a>
  </nav>
  {(['Juicebox','Revnet'] as const).map(name=>name==='Revnet'&&(!isRevnet||!visitedRevnet)?null:<div key={name} className={styles.browserPage} hidden={active!==name} role={isRevnet?'tabpanel':undefined} id={`${id}-${name}-panel`} aria-labelledby={isRevnet?`${id}-${name}-tab`:undefined}>
   <iframe key={`${projectUrl}:${reload[name]}`} src={name==='Revnet'?identity!.revnetUrl:projectUrl} title={`${name} project`} allow="clipboard-write; payment; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
  </div>)}
 </div>;
}
