"use client";

import { hasParaSessionMarker, markParaSession } from "./ParaAuthContext";

type ParaSessionModule = typeof import("./para-config");
type ParaSessionLoader = () => Promise<ParaSessionModule>;

const loadParaSession: ParaSessionLoader = () => import("./para-config");

type VerifyMarkedParaSessionOptions = {
  hasMarker?: () => boolean;
  load?: ParaSessionLoader;
  markSession?: (active: boolean) => void;
};

/**
 * Verify the lightweight reconnect marker against Para's authoritative
 * session state. A transient SDK or network failure is deliberately
 * inconclusive and must not erase a session that can recover on the next load.
 */
export async function verifyMarkedParaSession({
  hasMarker = hasParaSessionMarker,
  load = loadParaSession,
  markSession = markParaSession,
}: VerifyMarkedParaSessionOptions = {}): Promise<boolean | undefined> {
  if (!hasMarker()) return undefined;

  try {
    const { getParaClient } = await load();
    const loggedIn = await getParaClient().isFullyLoggedIn();
    if (!loggedIn) markSession(false);
    return loggedIn;
  } catch {
    return undefined;
  }
}
