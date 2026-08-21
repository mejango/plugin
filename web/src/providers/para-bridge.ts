"use client";

import { markParaSession } from "./ParaAuthContext";

type ParaSessionModule = typeof import("./para-config");
type ParaSessionLoader = () => Promise<ParaSessionModule>;

const loadParaSession: ParaSessionLoader = () => import("./para-config");

type ParaConnector = { id: string };

type ConnectParaSessionOptions<TConnector extends ParaConnector> = {
  connectors: readonly TConnector[];
  connect: (connector: TConnector) => Promise<unknown>;
  load?: ParaSessionLoader;
  markSession?: (active: boolean) => void;
};

/**
 * Bridge a completed Para authentication into Wagmi without making Para a
 * second source of wallet state.
 */
export async function connectParaSession<TConnector extends ParaConnector>({
  connectors,
  connect,
  load = loadParaSession,
  markSession = markParaSession,
}: ConnectParaSessionOptions<TConnector>): Promise<boolean> {
  const { getParaClient } = await load();
  if (!(await getParaClient().isFullyLoggedIn())) return false;

  const para = connectors.find((connector) => connector.id === "para");
  if (!para) return false;

  await connect(para);
  markSession(true);
  return true;
}
