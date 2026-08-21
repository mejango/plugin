"use client";

import { http, createConfig, fallback } from "wagmi";
// Deep path on purpose: `wagmi/connectors` is aliased to @wagmi/core in
// next.config.js for Para's sake, and that alias is exact-match only.
import { injected } from "wagmi/connectors/injected";

import { CHAINS } from "@/lib/chains";
import { PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { lazyParaConnector } from "@/providers/lazy-para-connector";

export const wagmiConfig = createConfig({
  chains: CHAINS,
  ssr: true,
  // EIP-6963 finds installed browser wallets without loading vendor SDKs.
  // Para sits behind a lazy delegate, so its ~725 KiB runtime is fetched only
  // once someone signs in or a marked session is restored — `reconnect()`
  // probes `getProvider()` on every connector, which the delegate
  // short-circuits.
  connectors: PARA_EMBEDDED_WALLET_ENABLED
    ? [injected({ shimDisconnect: true }), lazyParaConnector()]
    : [injected({ shimDisconnect: true })],
  transports: Object.fromEntries(CHAINS.map((c) => [c.id, fallback([http()])])) as never,
});
