import type { Address, Hex } from "viem";

import type { MachineDraft } from "@/lib/plugin/types";

/**
 * PluginDeployer, one address per chain. Deployed with a fixed CREATE2 salt,
 * so these match once every chain is done — see DEPLOYING.md.
 */
const PLUGIN_DEPLOYER: Record<number, Address | undefined> = {
  1: undefined,
  10: undefined,
  8453: undefined,
  42161: undefined,
};

/** JBProjects is the same address on every chain and charges an exact creation fee. */
export const JB_PROJECTS: Address = "0x6017d1fba9dc279bfa0b03fd931c22e242ab3691";

export function deployerFor(chainId: number): Address {
  const address = PLUGIN_DEPLOYER[chainId];
  if (!address) throw new Error(`plugin is not deployed on chain ${chainId} yet`);
  return address;
}

/** A machine's identity travels as inline JSON until IPFS pinning is wired. */
export function buildPitchUri(draft: MachineDraft, manual: string): string {
  const json = JSON.stringify({
    name: draft.name.trim(),
    description: draft.goal.trim(),
    manual,
  });
  return `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
}

export type SuckerConfig = {
  deployerConfigurations: readonly {
    deployer: Address;
    peer: Hex;
    mappings: readonly { localToken: Address; minGas: number; remoteToken: Hex }[];
  }[];
  salt: Hex;
};
