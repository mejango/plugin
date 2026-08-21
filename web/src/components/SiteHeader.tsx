import Link from "next/link";

import { SignIn } from "@/components/SignIn";

/**
 * The thin bar over every page: a way back on the left, the account on the
 * right.
 *
 * The bar is see-through to the pointer. It spans the full width across the
 * patch bay, so as a solid hit target it swallows every press aimed at the
 * jacks beneath it — on a short window that is the entire top row. Only the
 * controls opt back in.
 *
 * It positions ITSELF rather than being wrapped by the caller. A wrapper is a
 * second box over the same jacks, needing the same rule, and the version that
 * shipped without it left a full-width dead band 76px tall.
 */
export function SiteHeader({ back = false, floating = false }: { back?: boolean; floating?: boolean }) {
  return (
    <header
      className={`${floating ? "absolute inset-x-0 top-0" : "relative"} pointer-events-none z-[3] flex items-center justify-between px-[6vw] py-[1.3rem]`}
    >
      {back ? (
        <Link
          href="/"
          className="pointer-events-auto text-[.8rem] uppercase tracking-[.14em] no-underline opacity-70 hover:opacity-100"
        >
          ← back
        </Link>
      ) : (
        <span />
      )}
      <span className="pointer-events-auto">
        <SignIn compact />
      </span>
    </header>
  );
}
