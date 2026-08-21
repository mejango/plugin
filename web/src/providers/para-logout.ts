"use client";

import { markParaSession } from "./ParaAuthContext";

type ParaModule = typeof import("./para-config");
const loadPara: () => Promise<ParaModule> = () => import("./para-config");

type LogoutParaSessionOptions = {
  disconnect: () => Promise<unknown>;
  load?: () => Promise<ParaModule>;
  markSession?: (active: boolean) => void;
};

export class ParaSessionLogoutError extends Error {
  constructor() {
    super("Para did not confirm logout");
    this.name = "ParaSessionLogoutError";
  }
}

export class ParaLocalDisconnectError extends Error {
  constructor() {
    super("Para logged out but Wagmi did not disconnect");
    this.name = "ParaLocalDisconnectError";
  }
}

/**
 * End Para's authoritative session before disconnecting Wagmi.
 *
 * The local reconnect marker is cleared only after Para confirms logout. This
 * prevents the UI from claiming a completed sign-out while the embedded
 * wallet session is still live.
 */
export async function logoutParaSession({
  disconnect,
  load = loadPara,
  markSession = markParaSession,
}: LogoutParaSessionOptions): Promise<void> {
  const { getParaClient } = await load();
  try {
    await getParaClient().logout();
  } catch {
    throw new ParaSessionLogoutError();
  }
  markSession(false);
  try {
    await disconnect();
  } catch {
    throw new ParaLocalDisconnectError();
  }
}
