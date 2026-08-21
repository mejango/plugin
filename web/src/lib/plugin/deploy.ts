import { encodeFunctionData, type Address, type Hex } from "viem";

import { keepIndex, doublingIndex } from "@/lib/plugin/house";
import type { MachineDraft } from "@/lib/plugin/types";
import { pluginDeployerAbi } from "@/lib/plugin/abi";

/**
 * PluginDeployer, one address per chain. Deployed with a fixed CREATE2 salt,
 * so these match once every chain is done — see DEPLOYING.md.
 */
export const PLUGIN_DEPLOYER: Record<number, Address | undefined> = {
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

/**
 * Calldata for one chain's `startEngine`.
 *
 * CROSS-CHAIN DETERMINISM: `salt` and `startsAtOrAfter` MUST be identical on every
 * chain — they are hashed into the deterministic addresses, so a per-chain "now"
 * silently breaks sucker pairing. Routes carry THIS chain's twin of each project.
 */
export function encodeStartEngine(args: {
  draft: MachineDraft;
  chainId: number;
  pitchUri: string;
  startsAtOrAfter: number;
  salt: Hex;
  suckers: SuckerConfig;
}): Hex {
  const { draft, chainId, pitchUri, startsAtOrAfter, salt, suckers } = args;

  const machine = {
    name: draft.name.trim(),
    id: draft.id.trim().toUpperCase(),
    pitchUri,
    machine: draft.address.trim() as Address,
    keep: keepIndex(draft.keepPercent),
    doubling: doublingIndex(draft.doubling),
    startsAtOrAfter,
    salt,
    routes: draft.routes
      .map((route) => ({
        projectId: BigInt(route.machine.ids[chainId] ?? 0),
        percentOfKeep: route.percent,
        locked: route.locked,
      }))
      .filter((route) => route.projectId !== 0n),
  };

  return encodeFunctionData({
    abi: pluginDeployerAbi,
    functionName: "startEngine",
    args: [machine, suckers] as never,
  });
}
