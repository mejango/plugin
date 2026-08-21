"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { WagmiProvider, useAccount, useConnect, useConnectors } from "wagmi";

import { PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { ParaAuthContext } from "@/providers/ParaAuthContext";
import { SignInPlaceholder } from "@/providers/SignInPlaceholder";
import { connectParaSession } from "@/providers/para-bridge";
import { verifyMarkedParaSession } from "@/providers/para-session";

const ParaModalHost = React.lazy(() => import("@/providers/ParaModalHost"));

/**
 * Turns a completed Para authentication into a Wagmi connection, so Para never
 * becomes a second source of wallet state.
 */
function ParaConnectionBridge({
  modalOpen,
  sessionVersion,
}: {
  modalOpen: boolean;
  sessionVersion: number;
}) {
  const { isConnected } = useAccount();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const bridging = React.useRef(false);

  React.useEffect(() => {
    if (sessionVersion === 0 || modalOpen || isConnected || bridging.current) return;
    bridging.current = true;
    void connectParaSession({
      connectors,
      connect: (connector) => connectAsync({ connector }),
    })
      .catch(() => {
        // A failed bridge leaves the visitor signed out with the button still
        // there; Para's own session survives for the next attempt.
      })
      .finally(() => {
        bridging.current = false;
      });
  }, [connectAsync, connectors, isConnected, modalOpen, sessionVersion]);

  return null;
}

/**
 * Brings Para up in the background once the page is done and the browser is
 * idle, so by the time anyone clicks Sign in both the chunk and Para's own
 * async init have already finished.
 *
 * Skipped on metered or slow connections: this is ~725 KiB that a visitor who
 * never signs in does not need, and on those links the preload would cost more
 * than the wait it saves. They still get it on click.
 */
function useIdleParaWarmUp(warm: () => void) {
  const warmRef = React.useRef(warm);
  React.useEffect(() => {
    warmRef.current = warm;
  });

  React.useEffect(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    const link = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (link?.saveData) return;
    if (link?.effectiveType && /(^|-)2g$/.test(link.effectiveType)) return;

    let cancelled = false;
    const run = () => {
      if (!cancelled) warmRef.current();
    };
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const schedule = () => (idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 1500));

    let handle: number | undefined;
    const onLoad = () => {
      handle = schedule();
    };
    if (document.readyState === "complete") handle = schedule();
    else window.addEventListener("load", onLoad, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      if (handle !== undefined) window.clearTimeout(handle);
    };
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  // Kept apart: `hostLoaded` is whether Para's runtime has been fetched, which
  // an idle moment or a pointer hover can trigger on its own; `modalOpen` is
  // whether anyone actually asked to sign in.
  const [hostLoaded, setHostLoaded] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [sessionVersion, setSessionVersion] = React.useState(0);
  // Held here so it survives the placeholder handing over to the real sheet:
  // those are two components either side of a Suspense boundary, and anything
  // typed during the wait would otherwise go with the first one.
  const [entry, setEntry] = React.useState("");

  const loadHost = React.useCallback(() => setHostLoaded(true), []);
  useIdleParaWarmUp(loadHost);

  // Restore a marked embedded-wallet session without charging anonymous
  // visitors for it. Para's own session is authoritative; a transient failure
  // leaves the marker intact so a later load can still recover.
  React.useEffect(() => {
    if (PARA_EMBEDDED_WALLET_ENABLED) void verifyMarkedParaSession();
  }, []);

  const requestSignIn = React.useCallback(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    setHostLoaded(true);
    setModalOpen(true);
  }, []);
  const closeModal = React.useCallback(() => setModalOpen(false), []);
  const markSettled = React.useCallback(() => setSessionVersion((current) => current + 1), []);

  const paraAuth = React.useMemo(
    () => ({
      enabled: PARA_EMBEDDED_WALLET_ENABLED,
      modalOpen,
      sessionVersion,
      requestSignIn,
    }),
    [modalOpen, sessionVersion, requestSignIn],
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <ParaAuthContext.Provider value={paraAuth}>
          <ParaConnectionBridge modalOpen={modalOpen} sessionVersion={sessionVersion} />
          {children}
          {hostLoaded ? (
            <React.Suspense
              fallback={
                modalOpen ? <SignInPlaceholder entry={entry} onEntryChange={setEntry} /> : null
              }
            >
              <ParaModalHost
                open={modalOpen}
                onClose={closeModal}
                onSettled={markSettled}
                entry={entry}
                onEntryChange={setEntry}
              />
            </React.Suspense>
          ) : null}
        </ParaAuthContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
