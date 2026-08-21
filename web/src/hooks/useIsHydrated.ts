"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: the answer changes once, at hydration. */
const noSubscribe = () => () => {};

/**
 * False during SSR and the first client render, true afterwards.
 *
 * wagmi runs with `ssr: true`, so the server always renders the signed-out
 * markup. Anything that paints a connected account has to wait for hydration
 * or React reconciles two different trees.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
