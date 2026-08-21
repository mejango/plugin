"use client";

import { ParaModal, ParaProvider } from "@getpara/react-sdk-lite";
import type { StateSnapshot } from "@getpara/web-sdk";
import { useEffect, useRef } from "react";

import "@getpara/react-sdk-lite/styles.css";

import { PARA_APP, PARA_THEME, getParaClient } from "./para-config";

/**
 * Para's own auth modal, opened by us.
 *
 * Unlike revnet.money — which drives Para's headless hooks through a bespoke
 * sheet — this mounts the packaged modal. The seam is the same either way:
 * everything above talks to `requestSignIn()` and `sessionVersion`, so
 * swapping in a hand-built sheet later touches only this file.
 *
 * Loaded only once a visitor asks to sign in, or warmed on pointer intent.
 * `open` is owned by the caller so this holds no state of its own.
 */
export default function ParaModalHost({
  open,
  onClose,
  onSettled,
}: {
  open: boolean;
  /** Must be referentially stable: it gates a subscription to Para's stream. */
  onClose: () => void;
  onSettled: () => void;
}) {
  const para = getParaClient();
  // One settle per opening. Para reports `authenticated` repeatedly while a
  // session is live, and every report after the first is about a session the
  // bridge already picked up.
  const settled = useRef(false);

  useEffect(() => {
    if (open) settled.current = false;
  }, [open]);

  // Closing is what settles the flow: the transition is what tells Wagmi to
  // pick the new Para session up.
  useEffect(() => {
    return para.onStatePhaseChange((snapshot: StateSnapshot) => {
      if (snapshot.corePhase !== "authenticated" || settled.current) return;
      settled.current = true;
      onClose();
      onSettled();
    });
  }, [para, onClose, onSettled]);

  return (
    <ParaProvider
      paraClientConfig={para}
      config={{ appName: PARA_APP.appName }}
      paraModalConfig={{ authLayout: ["AUTH:FULL"], theme: PARA_THEME }}
      externalWalletConfig={{ wallets: [] }}
    >
      <ParaModal
        para={para}
        isOpen={open}
        onClose={() => {
          onClose();
          // A dismissed modal may still have authenticated — let the bridge
          // check rather than reading a close as a cancel.
          onSettled();
        }}
        theme={PARA_THEME}
      />
    </ParaProvider>
  );
}
