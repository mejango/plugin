"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { queryBendystraw } from "@/lib/bendystraw/client";
import { BendystrawOperations } from "@/lib/bendystraw/operations";
import { trendingMachines, latestActivity, type LatestData, type TrendingData, type TrendingMachine } from "@/lib/trending-machines";
import { displayMount, screenLayout } from "@/lib/patchboard/layout";
import { machineReadout, publishMachineReadout, VIEW_MODES, type ViewMode } from "@/lib/patchboard/readout";
import { BoardKnob } from "./BoardKnob";
import styles from "./HomeHero.module.css";

export function HomeHero() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [machines, setMachines] = useState<TrendingMachine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<ViewMode>(() => machineReadout().mode ?? "top");
  const [volume, setVolume] = useState(() => machineReadout().volume ?? 0);
  const changeMode = (index: number) => { const next=VIEW_MODES[index];if(next===mode)return;setMode(next);setMachines(null);setFailed(false); };

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

  useEffect(() => { publishMachineReadout({ machines, failed, mode, volume }); }, [machines, failed, mode, volume]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const rows = mode === "latest"
          ? latestActivity(await queryBendystraw<LatestData>(BendystrawOperations.LatestMachines))
          : trendingMachines(await queryBendystraw<TrendingData>(mode === "top" ? BendystrawOperations.TopMachines : mode === "new" ? BendystrawOperations.NewMachines : BendystrawOperations.TrendingMachines));
        if (active) { setMachines(rows); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [retry, mode]);

  const layout = screenLayout(viewport.width || 1440, viewport.height || 1000);
  const mount = displayMount(layout);
  const scale = viewport.width / layout.width;
  const left = (mount.left + layout.width / 2) * scale;
  const top = (layout.height - mount.top) * scale;

  return (
    <section className={styles.module} aria-label="Machine terminal" style={{ left, top, width: mount.width * scale, height: mount.height * scale }}>
      <div className="sr-only">
        <h1>{mode.toUpperCase()}</h1>
        <p>{mode === "latest" ? "Latest activity" : `${mode} machines`}</p>
        <table><thead><tr><th>{mode === "latest" ? "When" : "Ticker"}</th><th>Name</th><th>{mode === "latest" ? "Event" : "Balance"}</th></tr></thead>
          <tbody>{machines?.map((machine) => <tr key={machine.id}><td>{machine.ticker}</td><td>{machine.name}</td><td>{machine.fullBalance}</td></tr>)}</tbody>
        </table>
        <p role="status">{failed ? "Connection lost" : machines ? `${machines.length} ${mode === "latest" ? "events" : "machines"} across all chains` : "Reading machines"}</p>
      </div>
      <Link href="/create" className={styles.key} aria-label="Create a new machine" title="Create a new machine"
        style={{ left: (mount.keyX - mount.keySize / 2 - mount.left) * scale, top: (mount.top - mount.keyY - mount.keySize / 2) * scale, width: mount.keySize * scale, height: mount.keySize * scale }}>
        <span className="sr-only">Now</span>
      </Link>
      <BoardKnob label="View mode" value={VIEW_MODES.indexOf(mode)} max={3} step={1} text={mode} cycle onChange={changeMode}
        style={{ left: (mount.modeX - mount.knobRadius * 1.1 - mount.left) * scale, top: (mount.top - mount.modeY - mount.knobRadius * 1.1) * scale, width: mount.knobRadius * 2.2 * scale, height: mount.knobRadius * 2.2 * scale }} />
      <BoardKnob label="Volume" value={volume} max={1} step={0} text={`${Math.round(volume*100)}%`} onChange={setVolume}
        style={{ left: (mount.knobX - mount.knobRadius * 1.1 - mount.left) * scale, top: (mount.top - mount.knobY - mount.knobRadius * 1.1) * scale, width: mount.knobRadius * 2.2 * scale, height: mount.knobRadius * 2.2 * scale }} />
      {failed && <button className={styles.retry} type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button>}
    </section>
  );
}
