"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import type { Hex } from "viem";
import type { MachineDeploySession } from "@/lib/plugin/deploy-session";
import type { MachineDeployReview } from "@/lib/plugin/relayr-deploy";
import type { MachineDraft } from "@/lib/plugin/types";

type FundingOption = { chainId: number; label: string };
export type DeploymentApproval =
  | { id: number; kind: "funding"; options: FundingOption[] }
  | { id: number; kind: "review"; request: MachineDeployReview };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Deployment could not be completed.";
}

/** UI prompts are cancelable; the durable engine owns every send and recovery decision. */
export function useDeployMachine() {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const [session, setSession] = useState<MachineDeploySession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [canClear, setCanClear] = useState(false);
  const [approval, setApproval] = useState<DeploymentApproval | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const nextPromptId = useRef(0);
  const pending = useRef<{ id: number; finish: (value: number | boolean | null) => void } | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void import("@/lib/plugin/deploy-session").then(({ loadMachineDeployment, canClearMachineDeployment }) => {
      if (cancelled) return;
      const saved = loadMachineDeployment();
      setSession(saved);
      setCanClear(Boolean(saved && canClearMachineDeployment(saved)));
    }).catch(error => {
      if (!cancelled) setStorageError(messageOf(error));
    }).finally(() => {
      if (!cancelled) setRestoring(false);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      pending.current?.finish(null);
      pending.current = null;
    };
  }, []);

  const answerApproval = useCallback((id: number, value: number | boolean | null) => {
    if (pending.current?.id !== id) return;
    const current = pending.current;
    pending.current = null;
    setApproval(null);
    current.finish(value);
  }, []);

  const ask = useCallback((prompt: Omit<Extract<DeploymentApproval, { kind: "funding" }>, "id"> | Omit<Extract<DeploymentApproval, { kind: "review" }>, "id">) => {
    if (!mounted.current) return Promise.resolve(null);
    if (pending.current) return Promise.reject(new Error("Finish the current deployment review first."));
    const id = ++nextPromptId.current;
    return new Promise<number | boolean | null>(finish => {
      pending.current = { id, finish };
      setApproval({ ...prompt, id });
    });
  }, []);

  const deploy = useCallback(async (draft?: MachineDraft, manual?: string, executionHashes?: Partial<Record<number, Hex>>) => {
    if (running.current || restoring || storageError) return;
    if (!isConnected || !address) { setError("Connect the wallet that will deploy this machine."); return; }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const [{ runMachineDeployment }, { canClearMachineDeployment }] = await Promise.all([
        import("@/lib/plugin/relayr-deploy"), import("@/lib/plugin/deploy-session"),
      ]);
      await runMachineDeployment({
        config, account: address, draft, manual, executionHashes,
        onSession: next => {
          if (!mounted.current) return;
          setSession(structuredClone(next));
          setCanClear(canClearMachineDeployment(next));
        },
        onProgress: value => { if (mounted.current) setProgress(value); },
        chooseFunding: async options => {
          const result = await ask({ kind: "funding", options });
          return typeof result === "number" ? result : null;
        },
        review: async request => (await ask({ kind: "review", request })) === true,
      });
    } catch (error) {
      if (mounted.current) setError(messageOf(error));
    } finally {
      running.current = false;
      if (mounted.current) { setBusy(false); setProgress(null); }
    }
  }, [address, ask, config, isConnected, restoring, storageError]);

  const clear = useCallback(async () => {
    if (running.current || restoring) return;
    running.current = true;
    setBusy(true);
    try {
      const { clearMachineDeployment } = await import("@/lib/plugin/deploy-session");
      await clearMachineDeployment();
      if (mounted.current) { setSession(null); setCanClear(false); setError(null); }
    } catch (error) {
      if (mounted.current) setError(messageOf(error));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [restoring]);

  return { deploy, session, steps: session?.steps ?? [], busy, restoring, error: storageError ?? error,
    storageBlocked: Boolean(storageError), progress, canClear, clear, approval, answerApproval };
}
