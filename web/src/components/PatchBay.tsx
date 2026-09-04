"use client";

import { useEffect, useRef } from "react";

import { startPatchBay } from "@/lib/patchbay";
import { startPatchBay3D } from "@/lib/patchbay3d-engine";

/**
 * The interactive patch bay behind every page. The engine owns the canvas and
 * tears itself down on unmount, so React can mount it anywhere.
 *
 * `scrim` lays a translucent sheet between the bay and the page content — used on
 * form pages, where the cords are atmosphere rather than a toy.
 *
 * `solid` runs the 2.5D solid-cord engine from /lab3d instead — cords that
 * are grabbed, unplugged, caught on plugs and tugged free — on a bare board.
 */
export function PatchBay({ scrim = false, cables, bare, solid = false }: { scrim?: boolean; cables?: number; bare?: boolean; solid?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return solid ? startPatchBay3D(canvas, { cables }) : startPatchBay(canvas, { cables, bare });
  }, [cables, bare, solid]);

  return (
    <>
      <canvas ref={ref} aria-hidden className="fixed inset-0 z-0 touch-none" />
      {scrim ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[1] bg-white/[.65]" />
      ) : null}
    </>
  );
}
