"use client";

import { useEffect, useRef, useState } from "react";

import { PATCHBAY_SPLINE_VERSION, startPatchBaySpline } from "@/lib/patchbay-spline-engine";

// The bench: a blank board and a few cords, drawn as art-directed splines.
// Grab a plug end and drag it. Press R to copy a recording (f N matches it).
export default function Lab3dPage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    (canvas as unknown as { __lab: boolean }).__lab = true;
    const stop = startPatchBaySpline(canvas, { cables: 2 });
    const on = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    document.addEventListener("patchbay:copied", on, true);
    return () => { stop(); document.removeEventListener("patchbay:copied", on, true); };
  }, []);
  return (
    <main className="relative min-h-[100svh]">
      <canvas ref={ref} aria-hidden className="fixed inset-0 z-0 touch-none" />
      <div className="pointer-events-none fixed right-3 top-3 z-[2] font-mono text-[12px] text-[#999]">
        {PATCHBAY_SPLINE_VERSION} · R copies recording{copied ? " · copied" : ""}
      </div>
    </main>
  );
}
