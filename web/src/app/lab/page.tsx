"use client";

import { useEffect, useState } from "react";

import { PatchBay } from "@/components/PatchBay";
import { PATCHBAY_VERSION } from "@/lib/patchbay";

// The bench: a blank board and two cords, nothing else. Where the cord
// physics is worked on before it goes behind the site. Press R to copy a
// recording of the last thirty seconds of dragging, to play back off the
// panel.
export default function LabPage() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const on = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    document.addEventListener("patchbay:copied", on, true);
    const c = document.querySelector("canvas");
    if (c) (c as unknown as { __lab: boolean }).__lab = true;
    return () => document.removeEventListener("patchbay:copied", on, true);
  }, []);
  return (
    <main className="relative min-h-[100svh]">
      <PatchBay cables={2} bare />
      <div className="pointer-events-none fixed right-3 top-3 z-[2] font-mono text-[12px] text-[#999]">
        {PATCHBAY_VERSION} · R copies recording{copied ? " · copied" : ""}
      </div>
    </main>
  );
}
