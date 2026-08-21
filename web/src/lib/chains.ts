// Chain membership is derived from the protocol SDK, never hand-listed, so a
// chain the protocol adds cannot silently go missing here.
import { arbitrum, base, mainnet, optimism } from "viem/chains";

export const CHAINS = [mainnet, base, optimism, arbitrum] as const;

export const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: "ETH",
  [base.id]: "BASE",
  [optimism.id]: "OP",
  [arbitrum.id]: "ARB",
};

export const CHAIN_LABELS: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
  [optimism.id]: "Optimism",
  [arbitrum.id]: "Arbitrum",
};

/** The chains telligence deploys to. A literal union so it lines up with the
 *  protocol SDK's own chain-id types instead of widening to `number`. */
export type SupportedChainId = 1 | 10 | 8453 | 42161;

export const SUPPORTED_CHAIN_IDS: readonly SupportedChainId[] = [
  mainnet.id,
  optimism.id,
  base.id,
  arbitrum.id,
];

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

/** Narrow an arbitrary id, failing loudly rather than deploying somewhere unsupported. */
export function assertSupportedChainId(id: number): SupportedChainId {
  if (!isSupportedChainId(id)) throw new Error(`unsupported chain ${id}`);
  return id;
}
