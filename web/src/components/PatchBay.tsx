"use client";

import { useEffect, useRef } from "react";

import { startPatchBay } from "@/lib/patchbay";

/**
 * The interactive patch bay behind every page. The engine owns the canvas and
 * tears itself down on unmount, so React can mount it anywhere.
 *
 * `scrim` lays a translucent sheet between the bay and the page content — used on
 * form pages, where the cords are atmosphere rather than a toy.
 */
export function PatchBay({ scrim = false }: { scrim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return startPatchBay(canvas);
  }, []);

  return (
    <>
      <canvas ref={ref} aria-hidden className="fixed inset-0 z-0 touch-none" />
      {scrim ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[1] bg-white/[.65]" />
      ) : null}
    </>
  );
}
