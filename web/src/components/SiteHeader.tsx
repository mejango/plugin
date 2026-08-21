import Link from "next/link";

import { SignIn } from "@/components/SignIn";

/**
 * The thin bar over every page: a way back on the left, the account on the
 * right.
 *
 * The bar itself is see-through to the pointer. It spans the full width across
 * the patch bay's top row of jacks, so as a solid hit target it would swallow
 * every press aimed at them. Only the controls opt back in.
 */
export function SiteHeader({ back = false }: { back?: boolean }) {
  return (
    <header className="pointer-events-none relative z-[3] flex items-center justify-between px-[6vw] py-[1.3rem]">
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
