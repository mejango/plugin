import Link from "next/link";

import { SignIn } from "@/components/SignIn";

/**
 * The thin bar over every page: a way back on the left, the account on the right.
 * Sits above the patch bay, never over the scrim, so cords pass behind it.
 */
export function SiteHeader({ back = false }: { back?: boolean }) {
  return (
    <header className="relative z-[3] flex items-center justify-between px-[6vw] py-[1.3rem]">
      {back ? (
        <Link href="/" className="text-[.8rem] uppercase tracking-[.14em] no-underline opacity-70 hover:opacity-100">
          ← back
        </Link>
      ) : (
        <span />
      )}
      <SignIn compact />
    </header>
  );
}
