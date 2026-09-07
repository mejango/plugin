"use client";

import { jbProjectsAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import {
  readContract,
  getBytecode,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { useAccount, useConfig } from "wagmi";

import { CHAIN_LABELS } from "@/lib/chains";
import { buildPitchUri, buildDeployArgs, deployerFor, projectsFor } from "@/lib/plugin/deploy";
import type { MachineDraft } from "@/lib/plugin/types";

export type DeployStep = {
  chainId: number;
  label: string;
  status: "pending" | "signing" | "confirming" | "done" | "failed" | "skipped";
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
      setSteps([]);
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

      let activeChainId: number | null = null;
      try {
        const salt = randomSalt();
        const startsAtOrAfter = Math.floor(Date.now() / 1000) + 600;
        const pitchUri = buildPitchUri(draft, manual);
        const prepared=new Map(draft.chainIds.map(chainId=>[chainId,buildDeployArgs(draft,pitchUri,chainId,salt,startsAtOrAfter)]));
        // Confirm every selected chain is reachable and has the SDK's deployer
        // before asking for the first signature in a multi-chain deployment.
        for(const chainId of draft.chainIds){
          activeChainId=chainId;
          const code=await getBytecode(config,{chainId,address:deployerFor(chainId)});
          if(!code||code==="0x")throw new Error(`Revnet deployment is unavailable on ${CHAIN_LABELS[chainId]}.`);
        }
        for (const chainId of draft.chainIds) {
          activeChainId=chainId;
          const to = deployerFor(chainId);
          await switchChain(config, { chainId });

          // The creation fee is exact-equality and per-chain — never reuse one.
          const value = (await readContract(config, {
            chainId,
            address: projectsFor(chainId),
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
            abi: revDeployerAbi,
            functionName: "deployFor",
            args: prepared.get(chainId)!,
            value,
          });

          const hash = await writeContract(config, request);
          update(chainId, { status: "confirming", hash });
          const receipt=await waitForTransactionReceipt(config, { chainId, hash });
          if(receipt.status!=="success")throw new Error(`Deployment reverted on ${CHAIN_LABELS[chainId]??chainId}.`);
          update(chainId, { status: "done", hash });
        }
      } catch (err) {
        const message =
          err instanceof Error ? (err as { shortMessage?: string }).shortMessage ?? err.message : String(err);
        setError(message);
        setSteps((prev) =>
          prev.map((s) => s.chainId===activeChainId ? { ...s, status: "failed", error: message } : s.status==="pending" ? {...s,status:"skipped"} : s),
        );
      } finally {
        setBusy(false);
      }
    },
    [address, config, isConnected, update],
  );

  return { deploy, steps, busy, error };
}
