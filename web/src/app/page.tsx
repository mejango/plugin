import Link from "next/link";

import { CHIP_LG } from "@/components/chip";
import { PatchBay } from "@/components/PatchBay";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center px-[6vw] text-center">
      <PatchBay />

      {/* Floating, not in flow: the hero is centred on the viewport, and a bar
          taking part in that centring would push it down by its own height. */}
      <SiteHeader floating />

      {/*
        The hero is see-through to the pointer. The glyphs are huge and the bay
        is the whole page, so any jack that lands under a letter would otherwise
        be ungrabbable — the text would swallow the press. Only the button
        opts back in.
      */}
      <div className="pointer-events-none relative z-[2] flex flex-col items-center">
        {/*
          The gap under the title is a fixed 1.4rem, sitting next to a button
          that is itself sized in rem — so it stays the same next to the button
          at any viewport.

          Getting there takes the subtraction. At `leading-[0.75]` Anton leaves
          5.13% of the font size below the baseline — measured, not guessed — and
          that scales with the title, so the term cancels exactly that much and
          the `rem` is what is left. `min(31vw,44vh)` is the title size, so 5.13%
          of it is `min(1.6vw,2.26vh)`. The
          old code used `-1vh`, which tracked the viewport's HEIGHT while the
          title tracked its WIDTH: on a tall narrow phone the title shrank while
          the space grew, and the button ended up against the letters.

          It sits on the button rather than the title because `.display` resets
          `margin: 0` and wins on source order.
        */}
        <h1 className="display whitespace-nowrap text-[min(31vw,44vh)] leading-[0.75]">Plug in</h1>
        <Link
          href="/create"
          className={`${CHIP_LG} pointer-events-auto mt-[calc(1.4rem_-_min(1.6vw,2.26vh))] inline-block`}
        >
          Now
        </Link>
      </div>

      <p className="pointer-events-none fixed bottom-0 left-1/2 z-[2] m-0 -translate-x-1/2 bg-white/[.75] px-[1.2rem] pt-[.45rem] pb-[.55rem] text-[.75rem] text-[#999] backdrop-blur-[2px]">
        Runs on{" "}
        <a
          href="https://revnet.money"
          target="_blank"
          rel="noopener"
          className="pointer-events-auto underline underline-offset-2"
        >
          revnets
        </a>
      </p>
    </main>
  );
}
