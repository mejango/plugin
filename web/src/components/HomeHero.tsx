import Link from "next/link";
import { CHIP_LG } from "@/components/chip";

// Share the homepage typography and action without blocking the patchboard
// underneath the large glyphs. Only the button receives pointer events.
export function HomeHero() {
  return (
    <div className="pointer-events-none relative z-[2] flex flex-col items-center">
      <h1 className="display whitespace-nowrap text-[min(31vw,44vh)] leading-[0.75]">Plug in</h1>
      {/* Cancel Anton's below-baseline space, keeping a fixed gap to the button. */}
      <Link href="/create" className={`${CHIP_LG} pointer-events-auto mt-[calc(1.4rem_-_min(1.6vw,2.26vh))] inline-block`}>
        Now
      </Link>
    </div>
  );
}
