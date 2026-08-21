import { http, createConfig, fallback } from "wagmi";
import { injected } from "wagmi/connectors/injected";

import { CHAINS } from "@/lib/chains";

/**
 * One wagmi config for the app. `ssr: true` because pages render on the server
 * first; EIP-6963 discovery means installed wallets announce themselves rather
 * than us maintaining a connector list.
 */
export const wagmiConfig = createConfig({
  chains: CHAINS,
  ssr: true,
  connectors: [injected({ shimDisconnect: true })],
  transports: Object.fromEntries(CHAINS.map((c) => [c.id, fallback([http()])])) as never,
});
