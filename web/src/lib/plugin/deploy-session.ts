import { revDeployerAbi } from "@bananapus/nana-sdk-core";
import { encodeFunctionData, isAddress, isAddressEqual, keccak256, stringToHex, type Address, type Hex } from "viem";
import { assertSupportedChainId } from "@/lib/chains";
import { buildDeployArgs, buildPitchUri, deployerFor, deploymentCashOutTaxRate } from "@/lib/plugin/deploy";
import type { MachineDraft } from "@/lib/plugin/types";
import type { RelayrEntry, RelayrPayment, RelayrQuote, RelayrTransactionRecord, RelayrUnboundQuote } from "@/lib/plugin/relayr-protocol";

const STORAGE_KEY = "plugin-machine-deployment-v1";
export const MACHINE_DEPLOY_LOCK = "plugin-machine-deployment";

export type MachineDeployCall = { chainId: number; to: Address; data: Hex; value: string; label: string };
export type MachineDeployStep = {
  chainId: number;
  label: string;
  status: "pending" | "signing" | "confirming" | "done" | "failed" | "uncertain";
  hash?: Hex;
  /** Preserve a wallet-returned proposal or replaced hash after receipt recovery. */
  reportedHash?: Hex;
  projectId?: string;
  error?: string;
};
export type MachineDeployAuthorization = { chainId: number; nonce: string; deadline: number; entry: RelayrEntry };
export type MachineDeployRelayrAttempt = {
  signed: MachineDeployAuthorization[];
  published?: true;
  unboundQuote?: RelayrUnboundQuote;
  quote?: RelayrQuote;
  previousQuotes?: RelayrQuote[];
  records: RelayrTransactionRecord[];
  payment?: RelayrPayment;
  paymentHash?: Hex;
  paymentStarted?: true;
  paymentConfirmed?: true;
};
export type MachineDeploySession = {
  version: 1;
  id: Hex;
  fingerprint: Hex;
  account: Address;
  transport: "direct" | "relayr";
  phase: "prepared" | "signing" | "quoting" | "quoted" | "payment-signing" | "executing" | "unresolved" | "done";
  draft: MachineDraft;
  manual: string;
  salt: Hex;
  startsAtOrAfter: number;
  pitchUri: string;
  calls: MachineDeployCall[];
  steps: MachineDeployStep[];
  relayr?: MachineDeployRelayrAttempt & {
    abandonable?: true;
    retryNonces?: Record<number, string>;
    history?: MachineDeployRelayrAttempt[];
  };
};

export function machineDeploymentFingerprint(session: Omit<MachineDeploySession, "fingerprint">): Hex {
  return keccak256(stringToHex(JSON.stringify([
    session.version, session.id, session.account.toLowerCase(), session.transport,
    session.draft, session.manual, session.salt, session.startsAtOrAfter, session.pitchUri,
    session.calls.map(call => [call.chainId, call.to.toLowerCase(), call.data.toLowerCase(), call.value]),
  ])));
}

/** Corrupt storage must block a fresh deployment, never look like no saved attempt. */
export function validateMachineDeployment(value: unknown): MachineDeploySession {
  try {
    const session = value as MachineDeploySession;
    if (session?.version !== 1 || !/^0x[0-9a-f]{64}$/iu.test(session.id) || session.salt !== session.id ||
      !isAddress(session.account) || !["direct", "relayr"].includes(session.transport) ||
      !["prepared", "signing", "quoting", "quoted", "payment-signing", "executing", "unresolved", "done"].includes(session.phase) ||
      !Array.isArray(session.calls) || !session.calls.length || session.calls.length > 4 ||
      !Array.isArray(session.steps) || session.steps.length !== session.calls.length ||
      !Array.isArray(session.draft.chainIds) || session.calls.length !== session.draft.chainIds.length ||
      new Set(session.calls.map(call => call.chainId)).size !== session.calls.length ||
      typeof session.manual !== "string" || session.pitchUri !== buildPitchUri(session.draft, session.manual) ||
      machineDeploymentFingerprint(session) !== session.fingerprint) throw new Error();
    const cashOutTaxRate = deploymentCashOutTaxRate(session.calls[0].data);
    for (const [index, call] of session.calls.entries()) {
      const chainId = assertSupportedChainId(call.chainId);
      if (session.draft.chainIds[index] !== chainId || !isAddressEqual(call.to, deployerFor(chainId)) ||
        !/^(0|[1-9][0-9]*)$/u.test(call.value) || BigInt(call.value) >= 2n ** 256n ||
        call.data.toLowerCase() !== encodeFunctionData({ abi: revDeployerAbi, functionName: "deployFor",
          args: buildDeployArgs(session.draft, session.pitchUri, chainId, session.salt, session.startsAtOrAfter, cashOutTaxRate) }).toLowerCase()) throw new Error();
      const step = session.steps[index];
      if (step.chainId !== chainId || !["pending", "signing", "confirming", "done", "failed", "uncertain"].includes(step.status) ||
        (step.hash !== undefined && !/^0x[0-9a-f]{64}$/iu.test(step.hash)) ||
        (step.reportedHash !== undefined && !/^0x[0-9a-f]{64}$/iu.test(step.reportedHash)) ||
        (step.status === "done" && (!step.hash || !step.projectId || !/^[1-9][0-9]*$/u.test(step.projectId)))) throw new Error();
    }
    if ((session.transport === "relayr") !== Boolean(session.relayr) ||
      (session.phase === "done" && session.steps.some(step => step.status !== "done"))) throw new Error();
    if (session.relayr && (!Array.isArray(session.relayr.signed) || !Array.isArray(session.relayr.records) ||
      session.relayr.signed.length > session.calls.length ||
      new Set(session.relayr.signed.map(item => item.chainId)).size !== session.relayr.signed.length ||
      session.relayr.signed.some(item => !session.calls.some(call => call.chainId === item.chainId)) ||
      (session.relayr.published && session.calls.some(call => session.steps.find(step => step.chainId === call.chainId)?.status !== "done" &&
        !session.relayr!.signed.some(item => item.chainId === call.chainId))) ||
      (session.relayr.previousQuotes !== undefined && !Array.isArray(session.relayr.previousQuotes)) ||
      (session.relayr.history !== undefined && !Array.isArray(session.relayr.history)) ||
      (session.relayr.paymentStarted && (!session.relayr.quote || !session.relayr.payment)) ||
      (session.relayr.paymentHash && !session.relayr.paymentStarted) ||
      (session.relayr.paymentHash && !/^0x[0-9a-f]{64}$/iu.test(session.relayr.paymentHash)))) throw new Error();
    return session;
  } catch {
    throw new Error("The saved deployment is invalid. Keep its recovery data and transaction history before starting another machine.");
  }
}

export function loadMachineDeployment(): MachineDeploySession | null {
  if (typeof window === "undefined") return null;
  let stored: string | null;
  try { stored = window.localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error("Allow browser storage to safely recover this deployment."); }
  if (stored === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stored); }
  catch { throw new Error("The saved deployment is unreadable. Keep its recovery data before starting another machine."); }
  return validateMachineDeployment(parsed);
}

export function saveMachineDeployment(session: MachineDeploySession): void {
  validateMachineDeployment(session);
  if (typeof window === "undefined") throw new Error("Deployment recovery requires browser storage.");
  const latest = loadMachineDeployment();
  if (latest && latest.id !== session.id) throw new Error("Another deployment is saved. Resume it before starting a different machine.");
  if (latest && latest.fingerprint !== session.fingerprint) throw new Error("The original deployment configuration changed in another tab.");
  const serialized = JSON.stringify(session);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    if (window.localStorage.getItem(STORAGE_KEY) !== serialized) throw new Error();
  } catch { throw new Error("Deployment recovery could not be saved. Allow browser storage before continuing."); }
}

export function canClearMachineDeployment(session: MachineDeploySession): boolean {
  if (session.phase === "done") return true;
  if (session.steps.some(step => ["done", "uncertain", "confirming"].includes(step.status) ||
    (session.transport === "direct" && step.status === "signing"))) return false;
  if (session.relayr?.published || session.relayr?.history?.length) return session.relayr.abandonable === true;
  return !session.relayr?.paymentStarted;
}

export async function clearMachineDeployment(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("This browser needs Web Locks to coordinate deployment recovery.");
  await navigator.locks.request(MACHINE_DEPLOY_LOCK, { ifAvailable: true }, lock => {
    if (!lock) throw new Error("This deployment is running in another tab.");
    const session = loadMachineDeployment();
    if (session && !canClearMachineDeployment(session)) throw new Error("This deployment may still execute. Check the saved transactions before starting another machine.");
    window.localStorage.removeItem(STORAGE_KEY);
    if (window.localStorage.getItem(STORAGE_KEY) !== null) throw new Error("The saved deployment could not be cleared.");
  });
}
