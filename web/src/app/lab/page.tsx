import { PatchBay } from "@/components/PatchBay";
import { PATCHBAY_VERSION } from "@/lib/patchbay";

// The bench: a blank board and two cords, nothing else. Where the cord
// physics is worked on before it goes behind the site.
export default function LabPage() {
  return (
    <main className="relative min-h-[100svh]">
      <PatchBay cables={2} bare />
      <div className="pointer-events-none fixed right-3 top-3 z-[2] font-mono text-[12px] text-[#999]">{PATCHBAY_VERSION}</div>
    </main>
  );
}
