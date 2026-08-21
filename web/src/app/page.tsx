import Link from "next/link";

import { PatchBay } from "@/components/PatchBay";

export default function HomePage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center px-[6vw] text-center">
      <PatchBay />
      <h1 className="display relative z-[2] text-[min(16vw,24vh)] max-[620px]:text-[min(20.5vw,15vh)]">
        Telligence
        <br />
        money
        <br />
        network
      </h1>
      <div className="relative z-[2] mt-[4vh]">
        <Link
          href="/create"
          className="inline-block border-2 border-black bg-white/[.75] px-[1.1em] py-[.55em] text-[1.05rem] uppercase tracking-[0.14em] backdrop-blur-[2px] hover:bg-black hover:text-white max-[620px]:text-[1.35rem]"
        >
          Plug in
        </Link>
      </div>
      <p className="fixed bottom-0 left-1/2 z-[2] m-0 -translate-x-1/2 bg-white/[.75] px-[1.2rem] pt-[.45rem] pb-[.55rem] text-[.75rem] text-[#999] backdrop-blur-[2px]">
        Runs on{" "}
        <a href="https://revnet.money" target="_blank" rel="noopener" className="underline underline-offset-2">
          revnets
        </a>
      </p>
    </main>
  );
}
