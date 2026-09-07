"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { queryBendystraw } from "@/lib/bendystraw/client";
import { BendystrawOperations } from "@/lib/bendystraw/operations";
import { trendingMachines, latestActivity, type LatestData, type TrendingData, type TrendingMachine } from "@/lib/trending-machines";
import { displayMount, screenLayout } from "@/lib/patchboard/layout";
import { machineReadout, publishMachineReadout, VIEW_MODES, type ViewMode } from "@/lib/patchboard/readout";
import { projectReadout, type ProjectStatsData, type StatsProject } from "@/lib/project-readout";
import { BoardKnob } from "./BoardKnob";
import styles from "./HomeHero.module.css";

export function HomeHero() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [machines, setMachines] = useState<TrendingMachine[] | null>(null);
  const [offset,setOffset]=useState(0);
  const [selected,setSelected]=useState(0);
  const [totalCount,setTotalCount]=useState<number|null>(null);
  const [opened,setOpened]=useState<TrendingMachine|null>(null);
  const [detail,setDetail]=useState<ReturnType<typeof projectReadout>|null>(null);
  const [detailFailed,setDetailFailed]=useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<ViewMode>(() => machineReadout().mode ?? "top");
  const [volume, setVolume] = useState(() => machineReadout().volume ?? 0);
  const changeMode = (index: number) => { const next=VIEW_MODES[index];if(next===mode)return;setMode(next);setMachines(null);setFailed(false);setOffset(0);setSelected(0);setTotalCount(null);setOpened(null);setDetail(null); };

  useEffect(() => {
    const canvas = document.querySelector("canvas");
    const resize = () => {
      const rect = canvas?.getBoundingClientRect();
      setViewport({ width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight });
    };
    const observer = new ResizeObserver(resize);
    if (canvas) observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { publishMachineReadout({ machines, failed, mode, volume, totalCount, selected, detail:opened?(detail??{name:opened.name,rows:[]}):null, detailLoading:!!opened&&!detail&&!detailFailed, detailFailed }); }, [machines, failed, mode, volume, totalCount, selected, opened, detail, detailFailed]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const operation=mode === "latest" ? BendystrawOperations.LatestMachines : mode === "top" ? BendystrawOperations.TopMachines : mode === "new" ? BendystrawOperations.NewMachines : BendystrawOperations.TrendingMachines;
        const data=await queryBendystraw<LatestData & TrendingData>(operation,{offset});
        const rows=mode === "latest"?latestActivity(data):trendingMachines(data);
        const total=(mode === "latest"?data.activityEvents:data.suckerGroups).totalCount;
        if(active&&total!==undefined&&total>0&&offset>=total){setOffset(Math.floor((total-1)/6)*6);setSelected(0);return;}
        if (active) { setMachines(rows); setTotalCount(total??null); setSelected(n=>Math.min(n,Math.max(0,rows.length-1)));setFailed(false); }
      } catch {
        if (active) setFailed(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [retry, mode, offset]);

  useEffect(()=>{
    if(!opened)return;
    let active=true;
    async function read(){
      try {
        let groupId=opened!.groupId;
        if(!groupId){
          const data=await queryBendystraw<{project:StatsProject & {suckerGroupId:string|null}}>(BendystrawOperations.Project,{projectId:opened!.projectId,chainId:opened!.chainId});
          if(!data.project)throw new Error("Project unavailable");
          groupId=data.project.suckerGroupId??undefined;
          if(!groupId){if(active)setDetail(projectReadout(opened!,[{...data.project,deployErc20Events:{items:[]}}]));return;}
        }
        const data=await queryBendystraw<ProjectStatsData>(BendystrawOperations.SuckerGroup,{id:groupId});
        if(!data.suckerGroup?.projects.items.length)throw new Error("Project unavailable");
        if(active)setDetail(projectReadout(opened!,data.suckerGroup.projects.items));
      }catch{if(active)setDetailFailed(true);}
    }
    void read();return()=>{active=false;};
  },[opened,retry]);

  const navigate=useCallback((direction:"up"|"down"|"left"|"right")=>{
    if(opened){
      if(direction==="left"){setOpened(null);setDetail(null);setDetailFailed(false);}
      else if(direction==="right"&&detailFailed){setDetailFailed(false);setRetry(n=>n+1);}
      return;
    }
    if(!machines?.length)return;
    if(direction==="right"){setOpened(machines[selected]);setDetail(null);setDetailFailed(false);return;}
    if(direction==="left")return;
    const delta=direction==="down"?1:-1,next=selected+delta;
    if(next>=0&&next<machines.length){setSelected(next);return;}
    if(next<0&&offset>0){setOffset(n=>Math.max(0,n-6));setSelected(5);setMachines(null);}
    else if(next>=machines.length&&totalCount!==null&&offset+machines.length<totalCount){setOffset(n=>n+6);setSelected(0);setMachines(null);}
  },[opened,detailFailed,machines,selected,offset,totalCount]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||location.pathname!=="/"||event.altKey||event.metaKey||event.ctrlKey)return;
      if((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'))return;
      if(event.key==="Enter"&&(event.target as HTMLElement)?.closest("button,a"))return;
      const direction=({ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",Enter:"right",Escape:"left"} as const)[event.key as "ArrowUp"];
      if(direction){event.preventDefault();navigate(direction);}
    };
    window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);
  },[navigate]);

  const layout = screenLayout(viewport.width || 1440, viewport.height || 1000);
  const mount = displayMount(layout);
  const scale = viewport.width / layout.width;
  const left = (mount.left + layout.width / 2) * scale;
  const top = (layout.height - mount.top) * scale;

  return (
    <section data-board-terminal className={styles.module} aria-label="Machine terminal" style={{ left, top, width: mount.width * scale, height: mount.height * scale }}>
      <div className="sr-only">
        <h1>{opened?opened.name:`${mode.toUpperCase()} PLUG INS`}</h1>
        <p>{mode === "latest" ? "Latest activity" : `${mode} machines`}</p>
        <table aria-label="Plug ins" hidden={!!opened}><thead><tr><th>{mode === "latest" ? "When" : "Ticker"}</th><th>Name</th><th>{mode === "latest" ? "Event" : "Balance"}</th></tr></thead>
          <tbody>{machines?.map((machine,i) => <tr key={machine.id} aria-selected={i===selected}><td>{machine.ticker}</td><td>{machine.name}</td><td>{machine.fullBalance}</td></tr>)}</tbody>
        </table>
        {opened && <div aria-label="Project statistics">{detailFailed?"Stats unavailable. Press right to retry.":detail?detail.rows.map(row=><p key={row.label}>{row.label}: {row.value}</p>):"Reading project stats"}</div>}
        <p role="status">{failed ? "Connection lost" : machines ? `${totalCount??"Unknown number of"} ${mode === "latest" ? "events" : "machines"} across all chains` : "Reading machines"}</p>
      </div>
      <Link href="/create" className={styles.key} aria-label="Create a new machine" title="Create a new machine"
        style={{ left: (mount.keyX - mount.keySize / 2 - mount.left) * scale, top: (mount.top - mount.keyY - mount.keySize / 2) * scale, width: mount.keySize * scale, height: mount.keySize * scale }}>
        <span className={styles.nowLight} aria-hidden="true" /><span className="sr-only">New</span>
      </Link>
      <BoardKnob label="View mode" value={VIEW_MODES.indexOf(mode)} max={3} step={1} text={mode} cycle onChange={changeMode}
        style={{ left: (mount.modeX - mount.knobRadius * 1.1 - mount.left) * scale, top: (mount.top - mount.modeY - mount.knobRadius * 1.1) * scale, width: mount.knobRadius * 2.2 * scale, height: mount.knobRadius * 2.2 * scale }} />
      <BoardKnob label="Volume" value={volume} max={1} step={0} text={`${Math.round(volume*100)}%`} onChange={setVolume}
        style={{ left: (mount.knobX - mount.knobRadius * 1.1 - mount.left) * scale, top: (mount.top - mount.knobY - mount.knobRadius * 1.1) * scale, width: mount.knobRadius * 2.2 * scale, height: mount.knobRadius * 2.2 * scale }} />
      <div className={styles.navigation} role="group" aria-label="Screen navigation" style={{left:(mount.navX-mount.navSize/2-mount.left)*scale,top:(mount.top-mount.navY-mount.navSize/2)*scale,width:mount.navSize*scale,height:mount.navSize*scale}}>
        {(["up","left","right","down"] as const).map(direction=><button key={direction} type="button" data-direction={direction} aria-label={({up:"Previous row",down:"Next row",left:"Back to plug ins",right:detailFailed?"Retry project stats":"Open selected project"})[direction]} onClick={()=>navigate(direction)}>{({up:"▲",down:"▼",left:"◀",right:"▶"})[direction]}</button>)}
      </div>
      {failed && <button className={styles.retry} type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button>}
    </section>
  );
}
