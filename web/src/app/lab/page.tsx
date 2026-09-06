"use client";

import { useEffect, useRef, useState } from "react";

import { PATCHBAY_VERSION, startPatchBay } from "@/lib/patchbay";

// The bench: a blank board and two cords, nothing else. Where the cord
// physics is worked on before it goes behind the site. Press R to copy a
// recording of the last thirty seconds of dragging, to play back off the
// panel.
export default function LabPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const stop = startPatchBay(canvas, { cables: 2, bare: true });
    (canvas as unknown as { __lab: boolean }).__lab = true;
    const on = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    document.addEventListener("patchbay:copied", on, true);
    return () => { stop(); document.removeEventListener("patchbay:copied", on, true); };
  }, []);
  return (
    <main className="relative min-h-[100svh]">
      <canvas ref={ref} aria-hidden className="fixed inset-0 z-0 touch-none" />
      <div className="pointer-events-none fixed right-3 top-3 z-[2] font-mono text-[12px] text-[#999]">
        {PATCHBAY_VERSION} · R copies recording{copied ? " · copied" : ""}
      </div>
    </main>
  );
}
