"use client";

import { useEffect, useRef } from "react";
import { CreateForm } from "@/components/create/CreateForm";
import styles from "./Workstation.module.css";

export function Workstation({ active }: { active: boolean }) {
  const device = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const input = device.current?.querySelector<HTMLInputElement>('section[aria-label="Identity"] input');
      input?.focus({ preventScroll: true });
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 850);
    return () => clearTimeout(timer);
  }, [active]);
  return (
    <main className={styles.workstation} inert={!active} aria-hidden={!active} aria-label="Machine programming workstation">
      <div className={styles.bench} aria-hidden="true" />
      <div ref={device} className={styles.device}>
        <div className={styles.topline} aria-hidden="true"><span>PLUGIN COMPUTER</span><span>WORKSTATION / 01</span></div>
        <div className={styles.monitor}>
          <div className={styles.glass}><CreateForm screen /></div>
        </div>
        <div className={styles.chin} aria-hidden="true">
          <span className={styles.vents} /><span className={styles.brand}>Make a machine.</span><span className={styles.power}><i /> ONLINE</span>
        </div>
        <div className={styles.socket} aria-hidden="true"><i data-patch-link /><span>PATCH LINK</span></div>
      </div>
      <div className={styles.stand} aria-hidden="true" />
      <div className={styles.keyboard} aria-hidden="true">
        {["Q W E R T Y U I O P", "A S D F G H J K L", "Z X C V B N M"].map((row,index)=><div key={row} style={{paddingInline:`${index*12}px`}}>{row.split(" ").map(key=><span key={key}>{key}</span>)}</div>)}
        <div><span className={styles.spacebar} /><span className={styles.enter}>↵</span></div>
      </div>
    </main>
  );
}
