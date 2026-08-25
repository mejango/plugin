"use client";

import { useEffect, useRef, useState } from "react";

import { PATCHBAY3D_VERSION, startPatchBay3D } from "@/lib/patchbay3d-engine";

// The 2.5D bench: a blank board and two cords with real depth (z-based over/under)
// and live swing. Press R to copy a recording. The frame counter (f N) matches it.
export default function Lab3dPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    (canvas as unknown as { __lab: boolean }).__lab = true;
    const stop = startPatchBay3D(canvas, { cables: 2 });
    const on = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    document.addEventListener("patchbay:copied", on, true);
    return () => { stop(); document.removeEventListener("patchbay:copied", on, true); };
  }, []);
  return (
    <main className="relative min-h-[100svh]">
      <canvas ref={ref} aria-hidden className="fixed inset-0 z-0 touch-none" />
      <div className="pointer-events-none fixed right-3 top-3 z-[2] font-mono text-[12px] text-[#999]">
        {PATCHBAY3D_VERSION} · R copies recording{copied ? " · copied" : ""}
      </div>
    </main>
  );
}
