"use client";

import { useEffect, useRef, useState } from "react";
import { startPatchboard, type BoardStatus, type PatchboardController } from "@/lib/patchboard/view";
import { DEFAULT_FEEL, FEEL_PRESETS, FEEL_SLIDERS, sanitizeFeel, type CableFeel } from "@/lib/patchboard/settings";

export function PatchboardExperience({ angle = false }: { angle?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<PatchboardController | null>(null);
  const [status, setStatus] = useState<BoardStatus>({ held: false, depth: 0.3, connected: 6, docking: false, blocked: false });
  const [error, setError] = useState("");
  const [feel, setFeel] = useState<CableFeel>({ ...DEFAULT_FEEL });
  const [preset, setPreset] = useState("¼-inch cable");
  const changeFeel = (next: CableFeel, name = "Custom") => {
    const settings = sanitizeFeel(next);
    setFeel(settings); setPreset(name); controller.current?.configure(settings);
    try { localStorage.setItem("patchboard-feel-v1", JSON.stringify(settings)); } catch { /* Storage is optional. */ }
  };
  useEffect(() => {
    let saved = { ...DEFAULT_FEEL };
    try { const raw = localStorage.getItem("patchboard-feel-v1"); if (raw) saved = sanitizeFeel(JSON.parse(raw)); } catch { /* Use defaults if storage is unavailable. */ }
    queueMicrotask(() => { setFeel(saved); setPreset(Object.keys(FEEL_PRESETS).find(k => JSON.stringify(FEEL_PRESETS[k]) === JSON.stringify(saved)) ?? "Custom"); });
    try { controller.current = startPatchboard(canvas.current!, setStatus, saved, angle); }
    catch (e) { queueMicrotask(() => setError(e instanceof Error ? e.message : "The 3D patchboard could not start.")); }
    return () => { controller.current?.dispose(); controller.current = null; };
  }, [angle]);
  return (
    <main className="fixed inset-0 isolate overflow-hidden bg-[#ece9e2] text-[#45483e]" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
      <div className="absolute inset-0">
        <canvas ref={canvas} className="h-full w-full touch-none outline-none" tabIndex={0} aria-label="Interactive 3D patchboard. Drag plugs or cords. Scroll while holding to change depth. Right-drag to orbit. Escape drops a cord." />
      </div>
      {!angle && <header className="pointer-events-none absolute left-6 right-6 top-5 flex items-start justify-between gap-4 sm:left-9 sm:right-9 sm:top-7">
        <div><h1 className="text-sm font-semibold tracking-[0.18em]">PATCHBOARD</h1><p className="mt-1 text-[10px] tracking-widest opacity-55">A STUDY IN CORDS & GRAVITY</p></div>
        <div className="pointer-events-auto flex gap-1 text-[11px]">
          <button className="rounded border border-black/15 bg-[#ece9e2]/90 px-3 py-2 hover:bg-white/60" onClick={() => controller.current?.view(true)}>Front</button>
          <button className="rounded border border-black/15 bg-[#ece9e2]/90 px-3 py-2 hover:bg-white/60" onClick={() => controller.current?.view(false)}>Orbit</button>
          <button className="ml-2 rounded border border-black/15 bg-[#ece9e2]/90 px-3 py-2 hover:bg-white/60" onClick={() => controller.current?.reset()}>Reset</button>
        </div>
      </header>}
      {error && <div role="alert" className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 -translate-y-1/2 rounded bg-white p-6 text-sm">{error}</div>}
      <details open={!angle} className="absolute right-6 top-24 w-64 rounded-lg border border-black/15 bg-[#f2f0e9]/95 p-4 text-[11px] shadow-sm backdrop-blur-sm sm:right-9">
        <summary className="cursor-pointer font-semibold tracking-wide">Cable feel <span className="float-right font-normal opacity-55">{preset}</span></summary>
        <div className="mt-4 max-h-[calc(100svh-270px)] overflow-y-auto pr-1">
          <label className="flex items-center justify-between gap-3">Preset
            <select aria-label="Cable preset" className="max-w-36 rounded border border-black/20 bg-transparent p-1" value={preset} onChange={e => changeFeel(FEEL_PRESETS[e.target.value], e.target.value)}>
              {preset === "Custom" && <option value="Custom" disabled>Custom</option>}
              {Object.keys(FEEL_PRESETS).map(name => <option key={name}>{name}</option>)}
            </select>
          </label>
          <p className="mb-4 mt-2 text-[10px] leading-4 opacity-55">Live adjustments · saved on this browser. Values are relative tuning controls.</p>
          <button className="mb-4 w-full rounded border border-[#74796b]/40 bg-[#e0e5d9] py-2 font-medium hover:bg-[#d5ddca]" onClick={() => changeFeel(FEEL_PRESETS["Firm + fast settling"], "Firm + fast settling")}>Try firm + fast settling</button>
          {[
            { title: "Stiffness & settling", keys: ["bend", "settling"] },
            { title: "Surface & motion", keys: ["damping", "cordFriction", "floorFriction"] },
            { title: "Handling", keys: ["grip", "stretch", "plugWeight", "socketResistance"] },
          ].map(group => <section key={group.title} aria-label={group.title}>
          <h2 className="mb-3 border-b border-black/10 pb-2 font-semibold">{group.title}</h2>
          {FEEL_SLIDERS.filter(s => group.keys.includes(s.key)).map(s => <label key={s.key} className="mb-4 block">
            <span className="flex justify-between"><span>{s.label}</span><output className="tabular-nums opacity-60">{feel[s.key].toFixed(2)}</output></span>
            <input aria-label={s.label} type="range" min={s.min} max={s.max} step={s.step} value={feel[s.key]} className="mt-2 block w-full accent-[#74796b]" onChange={e => changeFeel({ ...feel, [s.key]: Number(e.target.value) })} />
            <span className="mt-1 block text-[10px] leading-4 opacity-55">{s.hint}</span>
          </label>)}</section>)}
          {([["shapeMemory", "Rest-shape memory"], ["socketAssist", "Socket alignment assist"]] as const).map(([key, label]) => <label key={key} className="my-3 flex items-center justify-between gap-3">{label}<input type="checkbox" checked={feel[key]} className="accent-[#74796b]" onChange={e => changeFeel({ ...feel, [key]: e.target.checked })} /></label>)}
          <p className="mt-3 text-[10px] opacity-55">Earth gravity · always on · 9.81 m/s²</p>
          <button className="mt-2 w-full rounded border border-black/20 py-2 hover:bg-white" onClick={() => changeFeel({ ...DEFAULT_FEEL }, "¼-inch cable")}>Restore cable defaults</button>
        </div>
      </details>
      <footer className="pointer-events-none absolute bottom-5 left-6 right-6 flex flex-wrap items-end justify-between gap-4 text-[11px] sm:bottom-7 sm:left-9 sm:right-9">
        {!angle && <div className="rounded bg-[#ece9e2]/90 p-3 leading-6 backdrop-blur-sm">
          <p>Drag a plug to unplug · release near a free socket to connect</p>
          <p className="opacity-60">Scroll while holding: out / in · drag a cord to shape it</p>
          <p className="opacity-60">Right-drag: orbit · scroll: zoom · Esc: drop</p>
        </div>}
        <div className="pointer-events-auto ml-auto rounded bg-[#ece9e2]/90 p-3 backdrop-blur-sm">
          <p aria-live="polite" className="opacity-60">{status.blocked ? "Plug not seated · blocked · drag to retry" : status.docking ? "Seating plug…" : status.held ? `Holding · depth ${status.depth.toFixed(2)}` : `${status.connected} / 6 plugs connected · Earth gravity`}</p>
        </div>
      </footer>
    </main>
  );
}
