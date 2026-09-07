"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PatchboardExperience } from "@/lib/patchboard/experience";
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
    const scene=world.current,svg=cable.current,socket=scene?.querySelector('[data-patch-link]');
    if(!scene||!svg||!socket)return;
    const place=()=>{
      const box=scene.getBoundingClientRect(),target=socket.getBoundingClientRect();
      const x=(target.left+target.width/2-box.left)/innerWidth*1000;
      const y=(target.top+target.height/2-box.top)/innerHeight*1000;
      svg.querySelectorAll('path').forEach(path=>path.setAttribute('d',`M 990 760 C 1020 840 1010 ${y+100} ${x-45} ${y+50} S ${x-30} ${y} ${x} ${y}`));
    };
    const observer=new ResizeObserver(place);observer.observe(scene);observer.observe(socket);
    place();return()=>observer.disconnect();
  },[pathname]);
  if(!BOARD_ROUTES.has(pathname))return null;
  const editing=pathname==="/create";
  return <div className={styles.viewport}>
    <div ref={world} className={`${styles.world} ${editing ? styles.editing : ""}`} data-camera={editing ? "workstation" : "patchboard"}>
      <div className={styles.board} inert={editing}><PatchboardExperience angle /></div>
      <Workstation active={editing} />
      <svg ref={cable} className={styles.link} viewBox="0 0 2000 1000" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 12 760 C 100 900 86 560 144 560 S 164 510 174 510" fill="none" stroke="#1e342d" strokeWidth="15" />
        <path d="M 12 760 C 100 900 86 560 144 560 S 164 510 174 510" fill="none" stroke="#3b7768" strokeWidth="10" />
        <path d="M 12 760 C 100 900 86 560 144 560 S 164 510 174 510" fill="none" stroke="#7aab97" strokeWidth="2" />
        <circle cx="990" cy="760" r="12" fill="#324b3c" stroke="#adbbab" strokeWidth="3" />
      </svg>
    </div>
  </div>;
}
