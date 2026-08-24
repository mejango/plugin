import { PatchBay } from "@/components/PatchBay";

// The bench: a blank board and two cords, nothing else. Where the cord
// physics is worked on before it goes behind the site.
export default function LabPage() {
  return (
    <main className="relative min-h-[100svh]">
      <PatchBay cables={2} bare />
    </main>
  );
}
