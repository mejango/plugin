"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CreateForm } from "@/components/create/CreateForm";
import styles from "./Workstation.module.css";

export function Workstation({ active }: { active: boolean }) {
  const device = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const input = device.current?.querySelector<HTMLInputElement>('section[aria-label="Identity"] input');
      if(!device.current?.contains(document.activeElement))input?.focus({ preventScroll: true });
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 850);
    return () => clearTimeout(timer);
  }, [active]);
  return (
    <main className={styles.workstation} inert={!active} aria-hidden={!active} aria-label="Machine programming workstation">
      <div className={styles.bench} aria-hidden="true" />
      <div ref={device} className={styles.device}>
        <Link href="/" className={styles.back} aria-label="← Board"><span aria-hidden="true">←</span><span className={styles.backText}>Board</span></Link>
        <div className={styles.topline} aria-hidden="true"><span>PLUGIN COMPUTER</span><span>WORKSTATION / 01</span></div>
        <div className={styles.monitor}>
          <div className={styles.glass}><CreateForm /></div>
        </div>
        <div className={styles.chin} aria-hidden="true">
          <span className={styles.vents} /><span className={styles.power}><i /> ONLINE</span>
        </div>
        <div className={styles.socket} aria-hidden="true"><i data-patch-link /></div>
      </div>
      <div className={styles.stand} aria-hidden="true" />
    </main>
  );
}
