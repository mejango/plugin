"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { WagmiProvider, useAccount, useConnect, useConnectors } from "wagmi";

import { PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { ParaAuthContext } from "@/providers/ParaAuthContext";
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

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  // Kept apart: `hostLoaded` is whether Para's runtime has been fetched, which
  // a pointer hover can trigger on its own; `modalOpen` is whether anyone
  // actually asked to sign in.
  const [hostLoaded, setHostLoaded] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [sessionVersion, setSessionVersion] = React.useState(0);

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
  const markSettled = React.useCallback(
    () => setSessionVersion((current) => current + 1),
    [],
  );

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
            <React.Suspense fallback={null}>
              <ParaModalHost open={modalOpen} onClose={closeModal} onSettled={markSettled} />
            </React.Suspense>
          ) : null}
        </ParaAuthContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
