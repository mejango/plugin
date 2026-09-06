"use client";

import { usePathname } from "next/navigation";
import { PatchboardExperience } from "@/lib/patchboard/experience";

const BOARD_ROUTES=new Set(["/","/create","/patchboard-angle"]);

// This component belongs to the shared layout, not an individual page. Now
// and Back replace only the foreground; the canvas and physical world survive.
export function PatchboardBackdrop() {
  const pathname=usePathname();
  if(!BOARD_ROUTES.has(pathname))return null;
  return <div inert={pathname==="/create"}><PatchboardExperience angle /></div>;
}
