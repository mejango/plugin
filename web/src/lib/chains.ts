import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet, optimism, optimismSepolia, sepolia } from "viem/chains";

export const CHAINS = [mainnet, base, optimism, arbitrum, sepolia, baseSepolia, optimismSepolia, arbitrumSepolia] as const;

export const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: "ETH",
  [base.id]: "BASE",
  [optimism.id]: "OP",
  [arbitrum.id]: "ARB",
  [sepolia.id]: "SEP",
  [baseSepolia.id]: "BASE SEP",
  [optimismSepolia.id]: "OP SEP",
  [arbitrumSepolia.id]: "ARB SEP",
};

export const CHAIN_LABELS: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
  [optimism.id]: "Optimism",
  [arbitrum.id]: "Arbitrum",
  [sepolia.id]: "Sepolia",
  [baseSepolia.id]: "Base Sepolia",
  [optimismSepolia.id]: "Optimism Sepolia",
  [arbitrumSepolia.id]: "Arbitrum Sepolia",
};

/** The chains plugin deploys to. A literal union so it lines up with the
 *  protocol SDK's own chain-id types instead of widening to `number`. */
export type SupportedChainId = (typeof CHAINS)[number]["id"];

export const MAINNET_CHAIN_IDS: readonly SupportedChainId[] = [
  mainnet.id,
  optimism.id,
  base.id,
  arbitrum.id,
];

export const TESTNET_CHAIN_IDS: readonly SupportedChainId[] = [
  sepolia.id, optimismSepolia.id, baseSepolia.id, arbitrumSepolia.id,
];

const SUPPORTED_CHAIN_IDS: readonly SupportedChainId[] = [...MAINNET_CHAIN_IDS, ...TESTNET_CHAIN_IDS];

function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

/** Narrow an arbitrary id, failing loudly rather than deploying somewhere unsupported. */
export function assertSupportedChainId(id: number): SupportedChainId {
  if (!isSupportedChainId(id)) throw new Error(`unsupported chain ${id}`);
  return id;
}
