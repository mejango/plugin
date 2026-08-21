"use client";

import { createConnector, type CreateConnectorFn } from "wagmi";

type AnyConnectorFn = CreateConnectorFn<unknown, Record<never, never>, Record<never, never>>;
type ConnectorImplementation = ReturnType<AnyConnectorFn>;

export type LazyConnectorOptions = {
  id: string;
  name: string;
  type: string;
  /** Resolves the real connector factory. Called once, on first use, and
   *  handed Wagmi's config so a factory that needs transports can read them. */
  load: (config: Parameters<AnyConnectorFn>[0]) => Promise<CreateConnectorFn>;
  /**
   * Whether Wagmi's startup reconnect may initialize this connector.
   *
   * `reconnect()` calls `getProvider()` on EVERY configured connector, so
   * without this gate a vendor SDK is fetched on every page load whether or
   * not the visitor has ever used that wallet. Returning false keeps the
   * anonymous path clean; an explicit `connect()` bypasses the gate.
   */
  shouldRestore: () => boolean;
};

/**
 * A stable Wagmi connector whose implementation is imported on demand.
 *
 * Wagmi does not expose a public API for mutating a config's connector list,
 * so every connector we might use has to be in the initial topology. This
 * delegate keeps them there — persisted and reconnectable like any other —
 * while their SDKs stay out of the initial download.
 */
export function lazyConnector({
  id,
  name,
  type,
  load,
  shouldRestore,
}: LazyConnectorOptions): CreateConnectorFn {
  return createConnector((config) => {
    let implementation: ConnectorImplementation | undefined;
    let pending: Promise<ConnectorImplementation> | undefined;

    const getImplementation = () => {
      if (implementation) return Promise.resolve(implementation);
      pending ??= load(config)
        .then((factory) => {
          const connector = (factory as AnyConnectorFn)(config);
          return Promise.resolve(connector.setup?.()).then(() => {
            implementation = connector;
            return connector;
          });
        })
        .catch((error) => {
          pending = undefined;
          throw error;
        });
      return pending;
    };

    return {
      id,
      name,
      type,
      async connect(parameters) {
        return (await getImplementation()).connect(parameters);
      },
      async disconnect() {
        return (await getImplementation()).disconnect();
      },
      async getAccounts() {
        return (await getImplementation()).getAccounts();
      },
      async getChainId() {
        return (await getImplementation()).getChainId();
      },
      async getProvider(parameters) {
        // The fast path Wagmi's hydrated reconnect must take for a visitor who
        // has never used this wallet.
        if (!implementation && !shouldRestore()) return undefined;
        return (await getImplementation()).getProvider(parameters);
      },
      async isAuthorized() {
        if (!implementation && !shouldRestore()) return false;
        return (await getImplementation()).isAuthorized();
      },
      async switchChain(parameters) {
        const connector = await getImplementation();
        if (!connector.switchChain) {
          throw new Error(`${name} does not support chain switching`);
        }
        return connector.switchChain(parameters);
      },
      onAccountsChanged(accounts) {
        implementation?.onAccountsChanged(accounts);
      },
      onChainChanged(chainId) {
        implementation?.onChainChanged(chainId);
      },
      onConnect(connectInfo) {
        implementation?.onConnect?.(connectInfo);
      },
      onDisconnect(error) {
        implementation?.onDisconnect(error);
      },
      onMessage(message) {
        implementation?.onMessage?.(message);
      },
    };
  }) as CreateConnectorFn;
}
