"use client";

import { createContext, useContext } from "react";

const PARA_SESSION_MARKER = "telligence.para-session";

export function hasParaSessionMarker(): boolean {
  try {
    return window.localStorage.getItem(PARA_SESSION_MARKER) === "true";
  } catch {
    return false;
  }
}

export function markParaSession(active: boolean) {
  try {
    if (active) window.localStorage.setItem(PARA_SESSION_MARKER, "true");
    else window.localStorage.removeItem(PARA_SESSION_MARKER);
  } catch {
    // Storage can be blocked in privacy modes; the live Wagmi session remains
    // usable, it simply will not be restored on the next page load.
  }
}

export type ParaAuthController = {
  enabled: boolean;
  modalOpen: boolean;
  sessionVersion: number;
  requestSignIn: () => void;
};

export const ParaAuthContext = createContext<ParaAuthController>({
  enabled: false,
  modalOpen: false,
  sessionVersion: 0,
  requestSignIn: () => {},
});

export function useParaAuth() {
  return useContext(ParaAuthContext);
}
