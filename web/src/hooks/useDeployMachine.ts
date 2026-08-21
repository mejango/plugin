"use client";

import {
  MappableAsset,
  jbProjectsAbi,
  parseSuckerDeployerConfig,
} from "@bananapus/nana-sdk-core";
import {
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { useAccount, useConfig } from "wagmi";

import { CHAIN_LABELS, assertSupportedChainId } from "@/lib/chains";
import { pluginDeployerAbi } from "@/lib/plugin/abi";
import { JB_PROJECTS, buildPitchUri, deployerFor, type SuckerConfig } from "@/lib/plugin/deploy";
import { keepIndex, doublingIndex } from "@/lib/plugin/house";
import type { MachineDraft } from "@/lib/plugin/types";

export type DeployStep = {
  chainId: number;
  label: string;
  status: "pending" | "signing" | "confirming" | "done" | "failed";
  hash?: Hex;
  error?: string;
};

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/**
 * Starts a machine on every chosen chain.
 *
 * CROSS-CHAIN DETERMINISM (the protocol SDK spells this out, and the contract
 * assumes it): one salt and one `startsAtOrAfter` for every chain. Both are hashed
 * into the deterministic addresses, so a per-chain "now" silently breaks sucker
 * pairing and the machine lands as N unlinked revnets instead of one.
 */
export function useDeployMachine() {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((chainId: number, patch: Partial<DeployStep>) => {
    setSteps((prev) => prev.map((s) => (s.chainId === chainId ? { ...s, ...patch } : s)));
  }, []);

  const deploy = useCallback(
    async (draft: MachineDraft, manual: string) => {
      setError(null);
      if (!isConnected || !address) {
        setError("Connect a wallet first.");
        return;
      }
      if (draft.chainIds.length === 0) {
        setError("Pick at least one chain.");
        return;
      }

      setBusy(true);
      setSteps(
        draft.chainIds.map((chainId) => ({
          chainId,
          label: CHAIN_LABELS[chainId] ?? String(chainId),
          status: "pending" as const,
        })),
      );

      const salt = randomSalt();
      const startsAtOrAfter = Math.floor(Date.now() / 1000) + 600;
      const pitchUri = buildPitchUri(draft, manual);

      try {
        for (const chainId of draft.chainIds) {
          const to = deployerFor(chainId);
          await switchChain(config, { chainId });

          // Suckers bridge this chain to every other chain in the set.
          const suckers = (
            draft.chainIds.length > 1
              ? parseSuckerDeployerConfig(
                  assertSupportedChainId(chainId),
                  draft.chainIds.map(assertSupportedChainId),
                  [MappableAsset.NATIVE, MappableAsset.USDC],
                  { salt, version: 6, bridge: "ccip" },
                )
              : { deployerConfigurations: [], salt }
          ) as SuckerConfig;

          const machine = {
            name: draft.name.trim(),
            id: draft.id.trim().toUpperCase(),
            pitchUri,
            machine: draft.address.trim() as Hex,
            keep: keepIndex(draft.keepPercent),
            doubling: doublingIndex(draft.doubling),
            startsAtOrAfter,
            salt,
            // Each chain gets that chain's own twin of every routed project.
            routes: draft.routes
              .map((route) => ({
                projectId: BigInt(route.machine.ids[chainId] ?? 0),
                percentOfKeep: route.percent,
                locked: route.locked,
              }))
              .filter((route) => route.projectId !== 0n),
          };

          // The creation fee is exact-equality and per-chain — never reuse one.
          const value = (await readContract(config, {
            chainId,
            address: JB_PROJECTS,
            abi: jbProjectsAbi,
            functionName: "creationFee",
          })) as bigint;

          update(chainId, { status: "signing" });

          // Simulate before asking for a signature, so a doomed call fails here
          // with a readable reason instead of in the user's wallet.
          const { request } = await simulateContract(config, {
            chainId,
            account: address,
            address: to,
            abi: pluginDeployerAbi,
            functionName: "startEngine",
            args: [machine, suckers] as never,
            value,
          });

          const hash = await writeContract(config, request);
          update(chainId, { status: "confirming", hash });
          await waitForTransactionReceipt(config, { chainId, hash });
          update(chainId, { status: "done", hash });
        }
      } catch (err) {
        const message =
          err instanceof Error ? (err as { shortMessage?: string }).shortMessage ?? err.message : String(err);
        setError(message);
        setSteps((prev) =>
          prev.map((s) => (s.status === "signing" || s.status === "confirming" ? { ...s, status: "failed", error: message } : s)),
        );
      } finally {
        setBusy(false);
      }
    },
    [address, config, isConnected, update],
  );

  return { deploy, steps, busy, error };
}
