"use client";

/**
 * Warm Para's runtime on intent rather than on click.
 *
 * It is ~725 KiB gzipped and deliberately absent for anonymous visitors, so
 * fetching it when a pointer lands on a sign-in control — rather than when it
 * presses one — usually hides the download behind the moment before the
 * click. Repeat calls are free: the import cache dedupes them.
 *
 * Kept in its own module so importing it costs nothing: pulling this from the
 * providers tree would drag the whole Wagmi config into every caller.
 */
export function preloadParaHost() {
  void import("./ParaModalHost");
}
