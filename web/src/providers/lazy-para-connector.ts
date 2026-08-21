"use client";

import { type CreateConnectorFn } from "wagmi";

import { hasParaSessionMarker } from "./ParaAuthContext";
import { lazyConnector } from "./lazy-connector";

type ParaConnectorModule = typeof import("./para-config");
type ParaConnectorLoader = () => Promise<ParaConnectorModule>;

const loadParaConnector: ParaConnectorLoader = () => import("./para-config");

type LazyParaConnectorOptions = {
  load?: ParaConnectorLoader;
  shouldRestore?: () => boolean;
};

/**
 * Para's embedded wallet. Its SDK, worker, and session machinery are not
 * imported until a marked session is restored or the auth modal settles.
 */
export function lazyParaConnector({
  load = loadParaConnector,
  shouldRestore = hasParaSessionMarker,
}: LazyParaConnectorOptions = {}): CreateConnectorFn {
  return lazyConnector({
    id: "para",
    name: "Para",
    type: "para",
    shouldRestore,
    load: async (config) => {
      const { createParaWagmiConnector } = await load();
      return createParaWagmiConnector(config.transports ?? {});
    },
  });
}
