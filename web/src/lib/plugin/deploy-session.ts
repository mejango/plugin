import { revDeployerAbi } from "@bananapus/nana-sdk-core";
import { isRelayrLaunchPhase, relayrLaunchInFlight, relayrLaunchPaying, relayrPaymentDetails, relayrSentPaymentsSnapshot, sentRelayrPayment,
  type RelayrLaunchJournal, type RelayrPayment, type RelayrQuote, type RelayrSignedLaunch, type RelayrTransactionRecord } from "@bananapus/nana-sdk-core/review/relayr";
import { encodeFunctionData, isAddress, isAddressEqual, keccak256, stringToHex, type Address, type Hex } from "viem";
import { assertSupportedChainId } from "@/lib/chains";
import { buildDeployArgs, buildPitchUri, deployerFor, deploymentCashOutTaxRate } from "@/lib/plugin/deploy";
import type { MachineDraft } from "@/lib/plugin/types";

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
export type MachineDeploySession = {
  version: 1;
  id: Hex;
  fingerprint: Hex;
  account: Address;
  transport: "direct" | "relayr";
  draft: MachineDraft;
  manual: string;
  salt: Hex;
  startsAtOrAfter: number;
  pitchUri: string;
  calls: MachineDeployCall[];
  steps: MachineDeployStep[];
  relayr?: RelayrLaunchJournal;
};

export function machineDeploymentDone(session: Pick<MachineDeploySession, "steps">): boolean {
  return session.steps.every(step => step.status === "done");
}

/** The journal saved before the SDK's launch journal: same key, read and kept, never dropped. */
type LegacyRelayrAttempt = {
  signed: RelayrSignedLaunch[];
  published?: true;
  quote?: Omit<RelayrQuote, "transactions"> & { transactions?: RelayrTransactionRecord[] };
  records?: RelayrTransactionRecord[];
  payment?: RelayrPayment;
  paymentHash?: Hex;
  paymentStarted?: true;
  paymentConfirmed?: true;
  abandonable?: true;
  retryNonces?: Record<number, string>;
  history?: { signed: RelayrSignedLaunch[] }[];
};

function upgradeLegacyJournal(legacy: LegacyRelayrAttempt, account: Address): RelayrLaunchJournal {
  const superseded = (legacy.history ?? []).flatMap(attempt => attempt.signed);
  const journal: RelayrLaunchJournal = { account, phase: "signing", signed: legacy.signed, records: legacy.records ?? [],
    ...(legacy.published || superseded.length ? { published: true as const } : {}),
    ...(superseded.length ? { superseded } : {}),
    ...(legacy.retryNonces ? { retryNonces: legacy.retryNonces } : {}),
    ...(legacy.abandonable ? { abandonable: true as const } : {}),
    ...(legacy.quote ? { quote: { transactions: [], ...legacy.quote } } : {}) };
  if (legacy.paymentStarted && legacy.payment && legacy.quote) {
    const details = relayrPaymentDetails(legacy.payment, { bundleUuid: legacy.quote.bundle_uuid,
      destinationChainIds: legacy.signed.map(item => item.chainId), nowSeconds: 0 });
    journal.paymentChainId = details.chainId;
    journal.paymentDeadline = details.deadline.toString();
    if (legacy.paymentHash) {
      journal.payments = [sentRelayrPayment(details, legacy.paymentHash)];
      journal.paymentHash = legacy.paymentHash;
      journal.phase = legacy.paymentConfirmed ? "executing" : "submitted";
    } else journal.phase = "payment-signing";
  } else journal.phase = journal.quote ? "quoted" : journal.published ? "quoting" : "signing";
  return journal;
}

/** A session saved by an earlier build: its top-level phase is derived now, and its journal becomes the SDK's. */
function upgradeLegacySession(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const session = { ...value } as MachineDeploySession & { phase?: unknown };
  delete session.phase;
  const relayr = session.relayr as unknown as (LegacyRelayrAttempt & { phase?: unknown }) | undefined;
  if (relayr && typeof relayr === "object" && relayr.phase === undefined && Array.isArray(relayr.signed) && isAddress(session.account)) {
    session.relayr = upgradeLegacyJournal(relayr, session.account);
  }
  return session;
}

const signedValid = (session: MachineDeploySession, list: unknown, unique: boolean) => Array.isArray(list) &&
  (!unique || new Set(list.map((item: RelayrSignedLaunch) => item.chainId)).size === list.length) &&
  list.every((item: RelayrSignedLaunch) => item && typeof item === "object" && session.calls.some(call => call.chainId === item.chainId) &&
    item.entry?.chain === item.chainId && /^(0|[1-9][0-9]*)$/u.test(item.nonce) && Number.isSafeInteger(item.deadline));

function journalValid(session: MachineDeploySession): boolean {
  const journal = session.relayr;
  if (!journal) return true;
  return typeof journal === "object" && isRelayrLaunchPhase(journal.phase) && isAddress(journal.account) && isAddressEqual(journal.account, session.account) &&
    signedValid(session, journal.signed, true) && journal.signed.length <= session.calls.length && Array.isArray(journal.records) &&
    (journal.superseded === undefined || signedValid(session, journal.superseded, false)) &&
    (journal.payments === undefined || relayrSentPaymentsSnapshot(journal.payments) !== null) &&
    (!relayrLaunchPaying(journal.phase) || (journal.quote !== undefined && Number.isSafeInteger(journal.paymentChainId))) &&
    (journal.paymentHash === undefined || /^0x[0-9a-f]{64}$/iu.test(journal.paymentHash));
}

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
    const session = upgradeLegacySession(value) as MachineDeploySession;
    if (session?.version !== 1 || !/^0x[0-9a-f]{64}$/iu.test(session.id) || session.salt !== session.id ||
      !isAddress(session.account) || !["direct", "relayr"].includes(session.transport) ||
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
    if ((session.transport === "relayr") !== Boolean(session.relayr) || !journalValid(session)) throw new Error();
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
  if (machineDeploymentDone(session)) return true;
  if (session.steps.some(step => step.status === "done")) return false;
  const journal = session.relayr;
  if (!journal) return !session.steps.some(step => ["uncertain", "confirming", "signing"].includes(step.status));
  if (journal.published) return journal.abandonable === true;
  return !relayrLaunchInFlight(journal.phase);
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
