"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PatchboardExperience } from "@/lib/patchboard/experience";
import { juiceboxProjectUrl } from "@/lib/juicebox-project";
import { BoardAudio } from "./BoardAudio";
import { HomeHero } from "./HomeHero";
import { Workstation } from "@/components/Workstation";
import styles from "./PatchboardBackdrop.module.css";

const BOARD_ROUTES=new Set(["/","/create","/patchboard-angle"]);

// Both devices live in the shared layout. Navigation moves the camera while
// preserving the board's physics and the workstation's draft.
export function PatchboardBackdrop() {
  const pathname=usePathname();
  const world=useRef<HTMLDivElement>(null);
  const cable=useRef<SVGSVGElement>(null);
  useEffect(()=>{
    const scene=world.current,svg=cable.current;
    const from=scene?.querySelector('[data-board-link]'),to=scene?.querySelector('[data-patch-link]');
    if(!scene||!svg||!from||!to)return;
    const place=()=>{
      const box=scene.getBoundingClientRect();
      const point=(el:Element)=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2-box.left,y:r.top+r.height/2-box.top};};
      const start=point(from),end=point(to),width=box.width,height=box.height;
      svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
      const x1=start.x+28,x2=end.x-28,drop=Math.min(100,height*.12);
      const bottom=Math.max(start.y,end.y)+drop,middle=(x1+x2)/2;
      const d=`M ${x1} ${start.y} C ${x1+18} ${start.y} ${x1+8} ${bottom} ${middle} ${bottom} C ${x2-8} ${bottom} ${x2-18} ${end.y} ${x2} ${end.y}`;
      svg.querySelectorAll('[data-cord]').forEach(path=>path.setAttribute('d',d));
      svg.querySelector('[data-plug="board"]')?.setAttribute('transform',`translate(${start.x} ${start.y})`);
      svg.querySelector('[data-plug="computer"]')?.setAttribute('transform',`translate(${end.x} ${end.y}) scale(-1 1)`);
    };
    const observer=new ResizeObserver(place);observer.observe(scene);observer.observe(from);observer.observe(to);
    place();return()=>observer.disconnect();
  },[pathname]);
  const projectUrl=juiceboxProjectUrl(pathname);
  if(!BOARD_ROUTES.has(pathname)&&!projectUrl)return null;
  const editing=pathname==="/create"||!!projectUrl;
  return <div className={styles.viewport}>
    <BoardAudio active={pathname==="/"} />
    <div ref={world} className={`${styles.world} ${editing ? styles.editing : ""}`} data-camera={editing ? "workstation" : "patchboard"}>
      <div className={styles.board} inert={editing}>
        <PatchboardExperience angle />
        {pathname!=="/patchboard-angle" && <HomeHero />}
        <div className={styles.edge} aria-hidden="true"><div className={styles.edgePort}><i data-board-link /></div></div>
      </div>
      <Workstation active={editing} projectUrl={projectUrl} />
      <svg ref={cable} className={styles.link} viewBox="0 0 2000 1000" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="link-metal" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#53595a" /><stop offset=".22" stopColor="#f5f6ee" /><stop offset=".42" stopColor="#a9b1ac" /><stop offset=".7" stopColor="#626d68" /><stop offset="1" stopColor="#242e2b" />
          </linearGradient>
          <linearGradient id="link-rubber" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#243c33" /><stop offset=".28" stopColor="#668c78" /><stop offset=".5" stopColor="#3c6554" /><stop offset="1" stopColor="#172c25" />
          </linearGradient>
        </defs>
        <path data-cord fill="none" stroke="#172821" strokeOpacity=".2" strokeWidth="15" transform="translate(3 6)" />
        <path data-cord fill="none" stroke="#203c30" strokeWidth="12" />
        <path data-cord fill="none" stroke="#426f59" strokeWidth="9" />
        <path data-cord fill="none" stroke="#9aba9e" strokeOpacity=".4" strokeWidth="2" transform="translate(0 -2)" />
        {["board","computer"].map(end=><g key={end} data-plug={end}>
          <ellipse cx="0" cy="0" rx="6" ry="15" fill="#252c28" stroke="#c1c8bd" strokeWidth="2" />
          <rect x="0" y="-11" width="13" height="22" rx="2" fill="url(#link-metal)" stroke="#46554a" />
          <rect x="10" y="-9" width="14" height="18" rx="3" fill="url(#link-rubber)" stroke="#223b2d" />
          <path d="M 22 -7 L 32 -5 L 32 5 L 22 7 Z" fill="url(#link-rubber)" />
          <path d="M 14 -8 V 8 M 18 -8 V 8 M 23 -6 V 6 M 27 -5 V 5" stroke="#142e21" strokeOpacity=".65" strokeWidth="1.3" />
          <path d="M 3 -8 H 9" stroke="#fff" strokeOpacity=".6" />
        </g>)}
      </svg>
    </div>
  </div>;
}
