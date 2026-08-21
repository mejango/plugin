"use client";

import { getConnections } from "@wagmi/core";
import { useCallback, useState } from "react";
import { useAccount, useConfig, useConnect, useConnectors, useDisconnect } from "wagmi";

import { useIsHydrated } from "@/hooks/useIsHydrated";
import { shortAddress } from "@/lib/format";
import { useParaAuth } from "@/providers/ParaAuthContext";
import { logoutParaSession } from "@/providers/para-logout";
import { preloadParaHost } from "@/providers/preload-para";

/**
 * The way in. Para's embedded wallet when it is configured — email, phone, or
 * a social account, no extension required — and the browser wallet otherwise.
 *
 * `compact` is the header treatment: smaller, quieter, sized to a nav bar.
 */
export function SignIn({ compact = false }: { compact?: boolean }) {
  const { enabled, requestSignIn } = useParaAuth();
  const { address, isConnected } = useAccount();
  const connectors = useConnectors();
  const { connect } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const config = useConfig();
  const [busy, setBusy] = useState(false);

  const hydrated = useIsHydrated();

  /**
   * End the session, whatever is holding it.
   *
   * Para's session outlives Wagmi's, so it is asked first whenever one exists
   * — not when the active connector happens to be named "para". Wagmi can then
   * still refuse, holding a connector it is no longer connected to; asking
   * each live connection to go is what actually clears that.
   */
  const endSession = useCallback(async () => {
    if (enabled) {
      const { getParaClient } = await import("@/providers/para-config");
      const live = await getParaClient()
        .isFullyLoggedIn()
        .catch(() => false);
      if (live) {
        await logoutParaSession({ disconnect: disconnectAsync });
        return;
      }
    }
    try {
      await disconnectAsync();
    } catch (error) {
      const connections = getConnections(config);
      if (connections.length === 0) throw error;
      for (const connection of connections) {
        await disconnectAsync({ connector: connection.connector });
      }
    }
  }, [config, disconnectAsync, enabled]);

  const base = compact
    ? "border-2 border-black bg-white/[.75] px-[.9em] py-[.4em] text-[.8rem] uppercase tracking-[.14em] backdrop-blur-[2px]"
    : "display w-full border-2 border-black bg-white px-[1.7em] py-[.75em] text-[clamp(1.1rem,2.4vw,1.5rem)] tracking-[.03em] min-[621px]:w-auto";

  if (!hydrated || !isConnected || !address) {
    return (
      <button
        type="button"
        // Fetch Para's runtime as the pointer arrives, so the click has
        // nothing left to wait for.
        onMouseEnter={enabled ? preloadParaHost : undefined}
        onFocus={enabled ? preloadParaHost : undefined}
        onTouchStart={enabled ? preloadParaHost : undefined}
        onClick={() => {
          if (enabled) requestSignIn();
          else if (connectors[0]) connect({ connector: connectors[0] });
        }}
        className={`${base} cursor-pointer hover:bg-black hover:text-white`}
      >
        Sign in
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      title={address}
      onClick={() => {
        setBusy(true);
        void endSession().finally(() => setBusy(false));
      }}
      className={`${base} group cursor-pointer hover:bg-black hover:text-white disabled:opacity-50`}
    >
      {/* The address until you mean to leave, then what leaving is called. */}
      <span className="group-hover:hidden">{shortAddress(address)}</span>
      <span className="hidden group-hover:inline">{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
