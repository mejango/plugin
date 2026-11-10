import { JBCoreContracts, erc2771ForwarderAbi, getJBContractAddress, jbProjectsAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { intent, isDefiniteWalletRejection, pollRelayrBundle, writeIntentKey, type SavedAttempt, type WriteHoldClient } from "@bananapus/nana-sdk-core/review";
import { advanceRelayrLaunch, bindRelayrQuote, FORWARD_REQUEST_TYPES, proveSavedRelayrPayment, readRelayrBundle,
  RELAYR_API, RELAYR_PAYMENT_GAS, RelayrDestinationRevertedError, RelayrPaymentRevertedError, RelayrProofError, relayrBundleRequest,
  relayrDeadlinePassed, relayrDestinationHash, relayrForwarder, relayrForwarderDeadline, relayrForwardRequest, relayrLaunchInFlight,
  relayrLaunchUnfunded, relayrPaymentAttemptOutcome, relayrPaymentDetails, relayrPaymentOptions, relayrRequestStates, relayrRequestsVerdict,
  relayrRetryOption, relayrSessionOutcome, relayrSupportsChains, requireRelayrPaymentRuntime, requireRelayrRetry, resignedRelayrLaunch,
  revertedRelayrQuote, sentRelayrPayment, simulateRelayrPayment, TRUSTED_FORWARDER_ABI, verifyRelayrDestination, verifyRelayrPayment,
  type RelayrEntry, type RelayrFinalizedClient, type RelayrLaunchJournal, type RelayrPayment, type RelayrProofClient, type RelayrSignedLaunch,
  type RelayrSignedRequest, type RelayrTransactionRecord } from "@bananapus/nana-sdk-core/review/relayr";
import { getAccount, getPublicClient, getWalletClient, switchChain, type Config } from "@wagmi/core";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, formatEther, isAddressEqual, numberToHex,
  parseAbi, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { assertSupportedChainId, CHAIN_LABELS } from "@/lib/chains";
import { buildDeployArgs, buildPitchUri, deployerFor, projectsFor } from "@/lib/plugin/deploy";
import { loadMachineDeployment, MACHINE_DEPLOY_LOCK, machineDeploymentDone, machineDeploymentFingerprint, saveMachineDeployment,
  type MachineDeployCall, type MachineDeploySession, type MachineDeployStep } from "@/lib/plugin/deploy-session";
import type { MachineDraft } from "@/lib/plugin/types";
import { recoverSaved, strictRetirable } from "@/lib/plugin/write-holds";
import { browserLocks, LockLostError, type LockHandle } from "@bananapus/nana-sdk-core/review/locks";

const SAFE_EXECUTE_ABI = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)"]);
const WALLET_CANCELED = "You canceled in your wallet.";
const AWAITING_HASH = "Waiting for the wallet to return the deployment hash.";
const SIMULATION_BALANCE = 100n * 10n ** 18n;
const activeDeployments = new Set<string>();
type LaunchEvent = Parameters<typeof advanceRelayrLaunch>[1];

export type MachineDeployReview = {
  kind: "authorization" | "payment" | "transaction";
  calls: MachineDeployCall[];
  authorization?: {
    domain: { name: string; version: string; chainId: string; verifyingContract: Address };
    message: { from: Address; to: Address; value: string; gas: string; nonce: string; deadline: number; data: Hex };
  };
};

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function forwarderFor(chainId: number): Address {
  const forwarder = relayrForwarder(assertSupportedChainId(chainId));
  if (!forwarder) throw new Error(`Relayr does not run on ${CHAIN_LABELS[chainId] ?? chainId}.`);
  return forwarder;
}
function paymentLabel(payment: RelayrPayment): string {
  return `${CHAIN_LABELS[payment.chain] ?? `Chain ${payment.chain}`} — ${formatEther(BigInt(payment.amount))} ETH`;
}
const MAY_HAVE_RUN = "An earlier deployment authorization may already have run. Check the machine on each chain, then change the setup to start over.";
const PAYMENT_UNMATCHED = "The saved payment couldn't be matched to this deployment and isn't refunded. Change the setup to start over.";
const NO_HASH = "Your wallet may have sent the Relayr payment without returning its hash. Check its activity; do not pay again.";
const EXPIRED_UNUSED = "The unused deployment authorizations expired. Resume to sign them again, or change the setup. An earlier payment is not refunded.";
function heldMessage(until: number): string {
  return until
    ? `A saved deployment authorization can still run until ${new Date(until * 1_000).toLocaleString()}. Resume after then.`
    : "A chain has not caught up with the saved deployment authorizations. Resume later.";
}

/**
 * A Relayr deploy payment the app can't authenticate (a saved hash its proof
 * refused, or a wallet that returned none), as the SDK's saved-attempt
 * recovery reads it: the one check, whose retirement marks the deployment
 * cancellable. The session's strict re-read is the final say before it retires.
 */
function relayrPaymentAttempt(id: Hex, account: Address, paymentChainId: number, hash?: Hex): SavedAttempt<never> {
  const attempt: SavedAttempt<never> = {
    chainId: paymentChainId,
    account,
    namespaces: [writeIntentKey("machine-relayr-payment", { id: intent.hex(id) })],
    saved: { started: true, ...(hash ? { hash } : {}) },
    // The app's own proof of this payment already failed: nothing here can show it.
    authenticate: async () => ({ result: "unknown" }),
    confirmRetirable: strictRetirable(() => attempt, () => {
      const now = loadMachineDeployment();
      return !!now && now.id === id && !!now.relayr && !now.relayr.abandonable && relayrLaunchInFlight(now.relayr.phase);
    }),
  };
  return attempt;
}
function randomSalt(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
function semantic(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint" || typeof item === "number") return String(item);
    if (typeof item === "string" && /^0x[0-9a-f]+$/iu.test(item)) return item.toLowerCase();
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    return item;
  });
}

/** The canonical project mint and revnet deployment must identify the frozen machine. */
export function machineProjectIdFromReceipt(receipt: TransactionReceipt, call: MachineDeployCall, account: Address): string {
  const chainId = assertSupportedChainId(call.chainId);
  const decoded = decodeFunctionData({ abi: revDeployerAbi, data: call.data });
  if (decoded.functionName !== "deployFor" || decoded.args.length !== 6 || decoded.args[0] !== 0n) {
    throw new Error("The deployment receipt does not identify a canonical new machine.");
  }
  const args = decoded.args;
  const created: bigint[] = [];
  const deployed: bigint[] = [];
  for (const log of receipt.logs) {
    if (isAddressEqual(log.address, projectsFor(chainId))) {
      try {
        const event = decodeEventLog({ abi: jbProjectsAbi, eventName: "Create", data: log.data, topics: log.topics });
        if (isAddressEqual(event.args.owner, call.to) && isAddressEqual(event.args.caller, call.to) && event.args.projectId > 0n) created.push(event.args.projectId);
      } catch { /* Only canonical project creation counts. */ }
    }
    if (!isAddressEqual(log.address, call.to)) continue;
    try {
      const event = decodeEventLog({ abi: revDeployerAbi, eventName: "DeployRevnet", data: log.data, topics: log.topics });
      if (event.args.revnetId > 0n && isAddressEqual(event.args.caller, account) &&
        semantic(event.args.configuration) === semantic(args[1]) &&
        semantic(event.args.suckerDeploymentConfiguration) === semantic(args[3]) &&
        event.args.terminalConfigurations.length >= 1 && event.args.terminalConfigurations.length <= 2 &&
        isAddressEqual(event.args.terminalConfigurations[0].terminal, getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId)) &&
        semantic(event.args.terminalConfigurations[0].accountingContextsToAccept) === semantic(args[2])) deployed.push(event.args.revnetId);
    } catch { /* Other events from the same deployer are not deployment evidence. */ }
  }
  if (created.length !== 1 || deployed.length !== 1 || created[0] !== deployed[0]) throw new Error("The destination receipt does not prove this exact machine configuration.");
  return created[0].toString();
}

/** Pin state and signatures before every externally observable step. */
export async function runMachineDeployment({ config, account, draft, manual, executionHashes, onSession, onProgress, chooseFunding, review }: {
  config: Config;
  account: Address;
  draft?: MachineDraft;
  manual?: string;
  executionHashes?: Partial<Record<number, Hex>>;
  onSession: (session: MachineDeploySession) => void;
  onProgress: (message: string) => void;
  chooseFunding: (options: { chainId: number; label: string }[]) => Promise<number | null>;
  review: (request: MachineDeployReview) => Promise<boolean>;
}): Promise<MachineDeploySession> {
  if (activeDeployments.has(MACHINE_DEPLOY_LOCK)) throw new Error("This deployment is already running.");
  activeDeployments.add(MACHINE_DEPLOY_LOCK);
  // A wallet outcome whose save a lost lock refused: applied under a fresh
  // lock, to the saved record only while it is still this attempt's.
  let late: ((saved: MachineDeploySession) => MachineDeploySession | undefined) | undefined;
  try {
    return await browserLocks().request(MACHINE_DEPLOY_LOCK, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("This deployment is already running in another tab.");
      try { return await run(lock); }
      catch (error) { throw isDefiniteWalletRejection(error) ? new Error(WALLET_CANCELED, { cause: error }) : error; }
    });
  } catch (error) {
    const settle = late;
    if (settle) await browserLocks().request(MACHINE_DEPLOY_LOCK, async lock => {
      const saved = loadMachineDeployment();
      const next = saved && settle(saved);
      if (!next) return;
      await lock!.assertHeld();
      saveMachineDeployment(next);
      onSession(clone(next));
    }).catch(() => undefined); // Unreconciled, the record stays as the lost lock left it.
    throw error;
  } finally { activeDeployments.delete(MACHINE_DEPLOY_LOCK); }

  function requireAccount() {
    const connected = getAccount(config).address;
    if (!connected || !isAddressEqual(connected, account)) throw new Error("Connect the wallet that started this deployment.");
  }
  async function clientFor(chainId: number): Promise<PublicClient> {
    assertSupportedChainId(chainId);
    const client = getPublicClient(config, { chainId }) as PublicClient | undefined;
    if (!client || await client.getChainId() !== chainId) throw new Error(`The RPC is not connected to ${CHAIN_LABELS[chainId] ?? chainId}.`);
    return client;
  }
  async function walletFor(chainId: number) {
    requireAccount();
    if (getAccount(config).chainId !== chainId) await switchChain(config, { chainId });
    requireAccount();
    const wallet = await getWalletClient(config, { chainId });
    if (wallet.chain.id !== chainId || !isAddressEqual(wallet.account.address, account) ||
      !(await wallet.getAddresses()).some(address => isAddressEqual(address, account))) {
      throw new Error("The wallet account or network changed. Review the deployment again.");
    }
    return wallet;
  }
  async function simulate(client: PublicClient, call: MachineDeployCall, gas: bigint, fundSigner: boolean) {
    const transaction = { from: account, to: call.to, data: call.data, value: numberToHex(BigInt(call.value)), gas: numberToHex(gas) };
    // Raw eth_call never follows a contract-controlled OffchainLookup URL. A
    // destination balance override changes no contract code or storage.
    const result = await client.request({ method: "eth_call", params: fundSigner
      ? [transaction, "latest", { [account]: { balance: numberToHex(BigInt(call.value) + SIMULATION_BALANCE) } }]
      : [transaction, "latest"] });
    if (typeof result !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(result) || result.length > 131_074) {
      throw new Error("The deployment simulation returned invalid data.");
    }
    return result;
  }
  async function feeUnchanged(call: MachineDeployCall, client: PublicClient) {
    const fee = await client.readContract({ address: projectsFor(call.chainId), abi: jbProjectsAbi, functionName: "creationFee" });
    if (fee !== BigInt(call.value)) throw new Error("A destination creation fee changed. Keep the saved deployment until its original authorizations are resolved.");
  }

  async function run(lock: LockHandle): Promise<MachineDeploySession> {
    requireAccount();
    let session = loadMachineDeployment();
    if (!session) {
      if (!draft || manual === undefined) throw new Error("Configure a machine before deploying.");
      const frozenDraft = clone(draft);
      if (!relayrSupportsChains(frozenDraft.chainIds)) throw new Error("Choose unique supported chains from the same network environment.");
      const salt = randomSalt();
      const startsAtOrAfter = Math.floor(Date.now() / 1000) + 600;
      const pitchUri = buildPitchUri(frozenDraft, manual);
      const calls: MachineDeployCall[] = [];
      let ordinaryAccount = true;
      for (const chainId of frozenDraft.chainIds) {
        const client = await clientFor(chainId);
        const to = deployerFor(chainId);
        const [code, accountCode, fee] = await Promise.all([
          client.getCode({ address: to }), client.getCode({ address: account }),
          client.readContract({ address: projectsFor(chainId), abi: jbProjectsAbi, functionName: "creationFee" }),
        ]);
        if (!code || code === "0x") throw new Error(`Revnet deployment is unavailable on ${CHAIN_LABELS[chainId]}.`);
        if (accountCode && accountCode !== "0x") ordinaryAccount = false;
        calls.push({ chainId, to, value: fee.toString(), label: `Deploy machine on ${CHAIN_LABELS[chainId]}`,
          data: encodeFunctionData({ abi: revDeployerAbi, functionName: "deployFor",
            args: buildDeployArgs(frozenDraft, pitchUri, chainId, salt, startsAtOrAfter) }).toLowerCase() as Hex });
      }
      requireAccount();
      const transport = calls.length > 1 && ordinaryAccount ? "relayr" : "direct";
      const prepared: Omit<MachineDeploySession, "fingerprint"> = {
        version: 1, id: salt, account, salt, startsAtOrAfter, pitchUri, transport,
        draft: frozenDraft, manual, calls,
        steps: calls.map(call => ({ chainId: call.chainId, label: CHAIN_LABELS[call.chainId] ?? String(call.chainId), status: "pending" })),
        ...(transport === "relayr" ? { relayr: resignedRelayrLaunch({ account }) } : {}),
      };
      session = { ...prepared, fingerprint: machineDeploymentFingerprint(prepared) };
    }
    const current = session;
    if (!isAddressEqual(current.account, account)) throw new Error("Connect the wallet that started this deployment.");
    /** `onLost`: what to apply to the saved record under a fresh lock if this save finds the lock lost. */
    async function persist(onLost?: typeof late) {
      try { await lock.assertHeld(); }
      catch (error) { if (onLost && error instanceof LockLostError) late = onLost; throw error; }
      // Preserve a just-returned wallet hash in the visible recovery state even
      // if storage fails. The earlier durable no-hash marker still blocks replay.
      try { saveMachineDeployment(current); } finally { onSession(clone(current)); }
    }
    async function step(chainId: number, next: Partial<MachineDeployStep>, onLost?: typeof late) {
      const item = current.steps.find(item => item.chainId === chainId);
      if (!item) throw new Error("The saved deployment chain changed.");
      Object.assign(item, next);
      await persist(onLost);
    }
    await persist();
    if (machineDeploymentDone(current)) return clone(current);
    try { await (current.transport === "direct" ? runDirect() : runRelayr()); }
    catch (error) {
      if (current.steps.some(item => item.status === "signing")) {
        current.steps.forEach(item => { if (item.status === "signing") item.status = "pending"; });
        await persist();
      }
      throw error;
    }
    return clone(current);

    async function verifyReceipt(call: MachineDeployCall, hash: Hex, expectedOuter?: { to: Address; data: Hex; value: string }, successOnly = false) {
      const client = await clientFor(call.chainId);
      const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
      if (tx.hash.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
        tx.chainId !== call.chainId || tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber ||
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) {
        throw new Error("The destination transaction is not in its canonical chain.");
      }
      const outer = expectedOuter ?? call;
      let exactCall = tx.to && isAddressEqual(tx.to, outer.to) && tx.input.toLowerCase() === outer.data.toLowerCase() && tx.value === BigInt(outer.value);
      if (!expectedOuter && exactCall && !isAddressEqual(tx.from, account)) exactCall = false;
      if (!exactCall && !expectedOuter && tx.to && isAddressEqual(tx.to, account)) {
        // A deployed Safe's externally mined transaction wraps the exact inner
        // deployment. A proposal ID alone will never pass this receipt check.
        try {
          const wrapped = decodeFunctionData({ abi: SAFE_EXECUTE_ABI, data: tx.input });
          exactCall = wrapped.functionName === "execTransaction" && wrapped.args[3] === 0 &&
            isAddressEqual(wrapped.args[0], call.to) && wrapped.args[1] === BigInt(call.value) && wrapped.args[2].toLowerCase() === call.data.toLowerCase();
        } catch { /* Other smart-account wrappers require explicit recovery support. */ }
      }
      if (!exactCall) throw new Error("The destination transaction does not match the saved deployment call.");
      if (receipt.status !== "success") {
        if (successOnly) throw new Error("The supplied transaction reverted. It cannot resolve the original wallet attempt.");
        await step(call.chainId, { status: "failed", hash, error: "Deployment reverted onchain." });
        return false;
      }
      const projectId = machineProjectIdFromReceipt(receipt, call, account);
      await step(call.chainId, { status: "done", hash, projectId, error: undefined });
      return true;
    }

    async function requireFinalizedReceipt(chainId: number, hash: Hex, expectedStatus?: "success" | "reverted") {
      const client = await clientFor(chainId);
      const receipt = await client.getTransactionReceipt({ hash });
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if ((expectedStatus && receipt.status !== expectedStatus) || receipt.transactionHash !== hash || finalized.number < receipt.blockNumber ||
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash ||
        (await client.getBlock({ blockNumber: finalized.number })).hash !== finalized.hash) {
        throw new Error("The original transaction is not finalized. Check it again before retrying this deployment.");
      }
    }

    async function runDirect() {
      for (const call of current.calls) {
        const status = current.steps.find(item => item.chainId === call.chainId)!;
        if (status.status === "done") continue;
        const suppliedHash = executionHashes?.[call.chainId];
        if (suppliedHash !== undefined) {
          if (!/^0x[0-9a-f]{64}$/iu.test(suppliedHash)) throw new Error("Enter the mined execution transaction hash for this chain.");
          const reportedHash = status.hash;
          // A supplied failed transaction says nothing about whether the
          // original wallet proposal is still live. Only exact success resolves it.
          await verifyReceipt(call, suppliedHash, undefined, true);
          if (reportedHash && reportedHash !== suppliedHash) await step(call.chainId, { reportedHash });
          continue;
        }
        if (status.hash) {
          onProgress(`Checking the saved deployment on ${CHAIN_LABELS[call.chainId]}.`);
          try {
            if (await verifyReceipt(call, status.hash)) continue;
          } catch (error) {
            await step(call.chainId, { status: "uncertain", error: errorMessage(error) });
            throw new Error("The saved transaction is unresolved. Check wallet activity before deploying again.");
          }
          // A canonical reverted transaction may be retried with the identical
          // pinned call. Its salt and start time are never regenerated.
          await requireFinalizedReceipt(call.chainId, status.hash, "reverted");
          await step(call.chainId, { hash: undefined, status: "pending", error: undefined });
        } else if (status.status === "uncertain" || status.status === "confirming") {
          throw new Error("Your wallet may have sent this deployment without returning its hash. Check its activity; do not deploy again.");
        }
        requireAccount();
        const client = await clientFor(call.chainId);
        await feeUnchanged(call, client);
        await step(call.chainId, { status: "signing", error: undefined });
        const estimate = await client.estimateGas({ account, to: call.to, data: call.data, value: BigInt(call.value) });
        const gas = estimate + estimate / 4n;
        await simulate(client, call, gas, false);
        if (!await review({ kind: "transaction", calls: [clone(call)] })) {
          await step(call.chainId, { status: "pending" });
          throw new Error("Deployment canceled before sending.");
        }
        const wallet = await walletFor(call.chainId);
        await feeUnchanged(call, client);
        await simulate(client, call, gas, false);
        requireAccount();
        await step(call.chainId, { status: "uncertain", error: AWAITING_HASH }); // Fenced, with no await before the wallet.
        /** The wallet's outcome, kept for a fresh lock while the saved step still awaits this attempt's hash. */
        const keep = (next: Partial<MachineDeployStep>) => (saved: MachineDeploySession) => {
          const item = saved.id === current.id ? saved.steps.find(item => item.chainId === call.chainId) : undefined;
          if (item?.status !== "uncertain" || item.hash || item.error !== AWAITING_HASH) return undefined;
          Object.assign(item, next);
          return saved;
        };
        let hash: Hex;
        try {
          hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: call.to, data: call.data, value: BigInt(call.value), gas });
        } catch (error) {
          if (!isDefiniteWalletRejection(error)) throw new Error("Your wallet may have sent the deployment without returning its hash. Check its activity; do not deploy again.", { cause: error });
          const unsent = { status: "pending", error: WALLET_CANCELED } as const;
          // A lost lock leaves the refusal to the fresh-lock reconcile; the caller still learns nothing was sent.
          await step(call.chainId, unsent, keep(unsent)).catch(saveError => { if (!(saveError instanceof LockLostError)) throw saveError; });
          throw error;
        }
        const sent = { status: "confirming", hash, error: undefined } as const;
        await step(call.chainId, sent, keep(sent));
        onProgress(`Confirming deployment on ${CHAIN_LABELS[call.chainId]}.`);
        try {
          await client.waitForTransactionReceipt({ hash, timeout: 120_000, onReplaced: () => {
            throw new Error("The wallet replaced this transaction. Keep the original hash and check the saved deployment.");
          } });
          if (!await verifyReceipt(call, hash)) throw new Error("Deployment reverted onchain. Resume to review the same deployment again.");
        } catch (error) {
          if (current.steps.find(item => item.chainId === call.chainId)!.status !== "failed") {
            await step(call.chainId, { status: "uncertain", error: errorMessage(error) });
          }
          throw error;
        }
      }
      onProgress("The machine is deployed on every selected chain.");
    }

    async function runRelayr() {
      if (!relayrSupportsChains(current.calls.map(call => call.chainId)) || current.calls.length < 2) throw new Error("The saved Relayr destinations are invalid.");
      let journal: RelayrLaunchJournal = current.relayr!;
      const chainClient = (chainId: number) => getPublicClient(config, { chainId }) as (PublicClient & RelayrFinalizedClient & RelayrProofClient) | undefined;
      const callOf = (chainId: number) => current.calls.find(call => call.chainId === chainId)!;
      const stepOf = (chainId: number) => current.steps.find(item => item.chainId === chainId)!;
      const open = (chainId: number) => stepOf(chainId).status !== "done";
      const save = async (event: LaunchEvent, onLost?: typeof late) => { if (advanceRelayrLaunch(journal, event)) await persist(onLost); };
      const requestOf = (signed: RelayrSignedLaunch) => {
        const call = current.calls.find(call => call.chainId === signed.chainId);
        const request = relayrForwardRequest(signed.entry);
        if (!call || !request || signed.entry.chain !== signed.chainId || !isAddressEqual(signed.entry.target, forwarderFor(signed.chainId)) ||
          signed.entry.value !== call.value || !isAddressEqual(request.from, account) || !isAddressEqual(request.to, call.to) ||
          request.data.toLowerCase() !== call.data.toLowerCase() || request.value !== BigInt(call.value) ||
          request.deadline !== signed.deadline || request.gas <= 0n) throw new Error("The saved authorization does not match this machine.");
        return request;
      };
      for (const signed of [...journal.signed, ...(journal.superseded ?? [])]) requestOf(signed);
      const signedRequest = ({ chainId, nonce, deadline }: RelayrSignedLaunch): RelayrSignedRequest => ({ chainId, signer: account, nonce, deadline });
      const published = (target: RelayrLaunchJournal) => [...target.signed, ...(target.superseded ?? [])];
      /** What the requests of chains not yet deployed allow, each at a canonical finalized block. Null once every chain is done. */
      const outstandingOutcome = async (signed: RelayrSignedLaunch[]) => {
        const outstanding = signed.filter(item => open(item.chainId));
        if (!outstanding.length) return null;
        const verdict = relayrRequestsVerdict(await relayrRequestStates(chainClient, outstanding.map(signedRequest)));
        return relayrSessionOutcome(verdict, { nonces: outstanding.map(item => item.nonce) });
      };
      /** Every published request is dead: the attempt may be abandoned, and it is not signed again here. */
      const abandon = async (line: string, cause?: unknown): Promise<never> => {
        journal.abandonable = true;
        current.steps.forEach(item => { if (item.status !== "done") { item.status = "failed"; item.error = line; } });
        await persist();
        throw new Error(line, cause === undefined ? undefined : { cause });
      };
      /** Signs the open chains again at their saved nonces, so the forwarder runs at most one of old and new. */
      const resign = async (from: RelayrLaunchJournal, abandonable: boolean) => {
        if (from.quote) current.relayrSuperseded = [...(current.relayrSuperseded ?? []), { quote: from.quote, records: from.records }];
        journal = resignedRelayrLaunch({ account, abandonable, superseded: published(from).filter(item => open(item.chainId)),
          retryNonces: { ...from.retryNonces, ...Object.fromEntries(from.signed.filter(item => open(item.chainId)).map(item => [item.chainId, item.nonce])) } });
        current.relayr = journal;
        current.steps.forEach(item => { if (item.status !== "done") { item.status = "pending"; delete item.hash; delete item.error; } });
        await persist();
      };
      const requireQuoteBindings = () => {
        const bindings = journal.quote?.expectedTransactions;
        if (!bindings?.length || bindings.length !== journal.signed.length || new Set(bindings.map(item => item.txUuid)).size !== bindings.length ||
          new Set(bindings.map(item => item.chain)).size !== bindings.length || journal.signed.some(signed => {
            const binding = bindings.find(item => item.chain === signed.chainId);
            return !binding || !isAddressEqual(binding.entry.target, signed.entry.target) ||
              binding.entry.data.toLowerCase() !== signed.entry.data.toLowerCase() || binding.entry.value !== signed.entry.value;
          })) throw new Error("The saved quote does not bind every exact deployment authorization.");
        return bindings;
      };
      const readRecords = async (read: Promise<{ transactions?: unknown }>) => {
        const { transactions } = await read;
        if (Array.isArray(transactions)) { journal.records = transactions as RelayrTransactionRecord[]; await persist(); }
      };

      /** The first candidate proven as its exact signed call, or why none is: an unproven read outranks a revert. */
      const proveDestination = async (chainId: number, candidates: { entry: RelayrEntry; hash: Hex }[]):
        Promise<{ receipt: TransactionReceipt; hash: Hex } | { unproven: unknown; reverted: Hex[] }> => {
        let unproven: unknown = null;
        const reverted: Hex[] = [];
        if (!candidates.length) return { unproven, reverted };
        const client = await clientFor(chainId);
        for (const candidate of candidates) {
          try { return { receipt: await verifyRelayrDestination(client, candidate), hash: candidate.hash }; }
          catch (error) {
            if (error instanceof RelayrDestinationRevertedError) reverted.push(candidate.hash);
            if (!unproven || unproven instanceof RelayrDestinationRevertedError) unproven = error;
          }
        }
        return { unproven, reverted };
      };

      /** Each superseded quote's hash reported for `chainId`, paired with the exact call that quote bound. */
      const supersededCandidates = (chainId: number) => (current.relayrSuperseded ?? []).flatMap(({ quote, records }) =>
        quote.expectedTransactions.filter(binding => binding.chain === chainId).flatMap(binding => records
          .filter(record => String(record.tx_uuid ?? "").toLowerCase() === binding.txUuid.toLowerCase())
          .flatMap(record => relayrDestinationHash(record) ?? []).map(hash => ({ entry: binding.entry, hash }))));
      const refreshSuperseded = async () => {
        if (!current.relayrSuperseded?.length) return;
        for (const item of current.relayrSuperseded) {
          try {
            const { transactions } = await readRelayrBundle(item.quote.bundle_uuid);
            if (Array.isArray(transactions)) item.records = transactions as RelayrTransactionRecord[];
          } catch { /* Relayr's availability never proves deployment or failure. */ }
        }
        await persist();
      };
      /** An authorization a retry superseded still runs at most once per chain: its proven success completes that chain. */
      const proveSuperseded = async () => {
        if (!current.relayrSuperseded?.length) return false;
        await refreshSuperseded();
        for (const call of current.calls) {
          if (!open(call.chainId)) continue;
          const proof = await proveDestination(call.chainId, supersededCandidates(call.chainId));
          if ("receipt" in proof) await step(call.chainId, { status: "done", hash: proof.hash, projectId: machineProjectIdFromReceipt(proof.receipt, call, account), error: undefined });
        }
        return machineDeploymentDone(current);
      };

      /** Receipts count only for the exact signed outer call; an unproven chain is classified by its request, whatever Relayr reports. */
      const reconcile = async (): Promise<boolean> => {
        const bindings = requireQuoteBindings();
        const original = journal;
        let retryable = true, expired = true, held = false, ran = false;
        const reverts: { chainId: number; hash: Hex }[] = [];
        await refreshSuperseded();
        for (const signed of original.signed) {
          if (!open(signed.chainId)) continue;
          const binding = bindings.find(item => item.chain === signed.chainId)!;
          const matching = original.records.filter(record => String(record.tx_uuid ?? "").toLowerCase() === binding.txUuid.toLowerCase());
          if (matching.length > 1) throw new Error("Relayr returned conflicting transaction records.");
          const saved = stepOf(signed.chainId).hash;
          const reported = matching[0] ? relayrDestinationHash(matching[0]) : null;
          const hash = saved ?? reported;
          // A relayer may replace its transaction: the saved hash and a newly reported one are both checked.
          const latestProof = await proveDestination(signed.chainId, [saved, reported].filter((item, index, all): item is Hex =>
            !!item && all.findIndex(other => other?.toLowerCase() === item.toLowerCase()) === index).map(item => ({ entry: signed.entry, hash: item })));
          // A superseded authorization's success completes the chain; its failures say nothing about the live request.
          const prior = "receipt" in latestProof ? null : await proveDestination(signed.chainId, supersededCandidates(signed.chainId));
          const proof = prior && "receipt" in prior ? prior : latestProof;
          if ("receipt" in proof) {
            try { await step(signed.chainId, { status: "done", hash: proof.hash, projectId: machineProjectIdFromReceipt(proof.receipt, callOf(signed.chainId), account), error: undefined }); }
            catch (error) { held = true; retryable = false; await step(signed.chainId, { status: "uncertain", hash: proof.hash, error: errorMessage(error) }); }
            continue;
          }
          const { unproven } = proof;
          const [state] = await relayrRequestStates(chainClient, [signedRequest(signed)]);
          const reverted = unproven instanceof RelayrDestinationRevertedError;
          const named = hash ? { hash } : {};
          if (reverted) reverts.push(...proof.reverted.map(item => ({ chainId: signed.chainId, hash: item })));
          if (!state.live && state.unused) {
            await step(signed.chainId, { status: "failed", ...named, error: reverted ? "Deployment reverted onchain." : "The unused deployment authorization expired." });
            continue;
          }
          if (!state.live) { ran = true; retryable = false; await step(signed.chainId, { status: "uncertain", ...named, error: MAY_HAVE_RUN }); continue; }
          held = true; expired = false;
          if (reverted) { await step(signed.chainId, { status: "failed", ...named, error: "Deployment reverted onchain." }); continue; }
          retryable = false;
          await step(signed.chainId, { status: "uncertain", ...named, error: unproven instanceof Error ? unproven.message : "Waiting for the original destination transaction." });
        }
        if (machineDeploymentDone(current)) { onProgress("The machine is deployed on every selected chain."); return true; }
        if (ran && !held) await abandon(MAY_HAVE_RUN);
        if (retryable) {
          // A retry keeps every success and supersedes every revert, so each must be final first, as must the latest payment.
          for (const item of current.steps) if (item.status === "done" && item.hash) await requireFinalizedReceipt(item.chainId, item.hash, "success");
          for (const item of reverts) await requireFinalizedReceipt(item.chainId, item.hash, "reverted");
          const payment = original.payments?.at(-1);
          if (payment) await requireFinalizedReceipt(payment.chainId, payment.hash);
          await resign(original, expired);
          onProgress("Retrying only verified unsuccessful destinations. The previous payment may already have been charged; review a new quote for these chains.");
        }
        return false;
      };

      // A quote whose own payment reverted may be funded by another payment, still payable, or released for a new quote.
      let fundedElsewhere = false;
      let unreleased: unknown = null;
      if (journal.phase === "payment-reverted" && journal.quote) {
        try {
          const reverted = await revertedRelayrQuote(chainClient, { bundleUuid: journal.quote.bundle_uuid, payments: journal.payments ?? [],
            options: journal.quote.payment_info, destinationChainIds: journal.signed.map(item => item.chainId), account });
          if (reverted.records) journal.records = reverted.records;
          fundedElsewhere = reverted.state === "funded";
          if (reverted.state === "released") advanceRelayrLaunch(journal, { type: "released" });
          await persist();
        } catch (error) { unreleased = error; }
      }
      // While a published request can still run, it is signed again only at its saved nonce.
      let heldUntil: number | null = null;
      if (journal.published && !fundedElsewhere && relayrLaunchUnfunded(journal.phase)) {
        if (await proveSuperseded()) { onProgress("The machine is deployed on every selected chain."); return; }
        const outcome = await outstandingOutcome(published(journal));
        if (outcome?.kind === "hold") throw new Error(heldMessage(outcome.until));
        if (outcome?.kind === "reorg-hold") throw new Error(heldMessage(0));
        if (outcome?.kind === "refresh") heldUntil = outcome.until;
        if (outcome?.kind === "discard" && outcome.reason === "ran") await abandon(MAY_HAVE_RUN);
        if (outcome?.kind === "discard" && !journal.abandonable) await abandon(EXPIRED_UNUSED);
        if (outcome && outcome.kind !== "refresh") unreleased = null;
        if (unreleased && heldUntil !== null) throw new Error(heldMessage(heldUntil), { cause: unreleased });
      }
      if (unreleased) throw unreleased;
      if (journal.abandonable && relayrLaunchUnfunded(journal.phase) && journal.signed.length) await resign(journal, true);

      if (relayrLaunchInFlight(journal.phase) || fundedElsewhere) {
        if (journal.phase === "submitted" || journal.phase === "executing") {
          const resumed = journal;
          try {
            await proveSavedRelayrPayment(chainClient, resumed.payments, account, () => advanceRelayrLaunch(resumed, { type: "reverted" }));
          } catch (error) {
            if (error instanceof RelayrPaymentRevertedError) await persist();
            if (!(error instanceof RelayrProofError) || error instanceof RelayrPaymentRevertedError) throw error;
            // The saved hash is another transaction. Once every request is dead the deployment can be abandoned; before that, the SDK's one check retires it.
            const outcome = await outstandingOutcome(published(resumed));
            if (outcome?.kind === "discard") await abandon(outcome.reason === "ran" ? MAY_HAVE_RUN : PAYMENT_UNMATCHED, error);
            const checked = await recoverSaved(relayrPaymentAttempt(current.id, account, resumed.paymentChainId!, resumed.paymentHash),
              chainClient(resumed.paymentChainId!) as unknown as WriteHoldClient, error instanceof Error ? error.message : undefined);
            if (checked.status === "none" && checked.retired === "check") await abandon(PAYMENT_UNMATCHED, error);
            throw error;
          }
        }
        onProgress("Checking the original payment and destination deployments.");
        try { await readRecords(readRelayrBundle(journal.quote!.bundle_uuid)); }
        catch { /* Relayr's availability never proves deployment or failure. */ }
        const original = journal;
        if (await reconcile()) return;
        // A payment the wallet may have sent without its hash keeps its journal, live or retryable, until it expires with every
        // request; its recovery check shows while requests are live. A destination hash still being proven stays unresolved.
        if (original.phase === "payment-signing" && !current.steps.some(item => item.status === "uncertain" && item.hash)) {
          journal = original;
          current.relayr = original;
          current.steps.forEach(item => { if (item.status === "pending") item.status = "uncertain"; });
          const outcome = await outstandingOutcome(published(original));
          const paymentExpired = original.paymentDeadline !== undefined && original.paymentChainId !== undefined &&
            await relayrDeadlinePassed(chainClient(original.paymentChainId)!, original.paymentDeadline) === true;
          if (outcome?.kind === "discard" && outcome.reason === "expired" && paymentExpired) original.abandonable = true;
          await persist();
          if (!original.abandonable) {
            // A payment the wallet may have sent without its hash: the SDK's one check, whose retirement makes it cancellable.
            const checked = await recoverSaved(relayrPaymentAttempt(current.id, account, original.paymentChainId!),
              chainClient(original.paymentChainId!) as unknown as WriteHoldClient, NO_HASH);
            if (checked.status === "none" && checked.retired === "check") await abandon(MAY_HAVE_RUN);
          }
          throw new Error(original.abandonable
            ? "The unused deployment authorizations expired. You may abandon this attempt. An earlier payment may still have been charged; check your wallet."
            : NO_HASH);
        }
        if (current.relayr === original) throw new Error("The original deployment is unresolved. Check its saved transactions; do not pay or deploy again.");
      }

      for (const call of current.calls) {
        if (!open(call.chainId) || journal.signed.some(signed => signed.chainId === call.chainId)) continue;
        requireAccount();
        const client = await clientFor(call.chainId);
        await feeUnchanged(call, client);
        const forwarder = forwarderFor(call.chainId);
        const [code, forwarderCode, trusted, nonce, domain] = await Promise.all([
          client.getCode({ address: account }), client.getCode({ address: forwarder }),
          client.readContract({ address: call.to, abi: TRUSTED_FORWARDER_ABI, functionName: "isTrustedForwarder", args: [forwarder] }),
          client.readContract({ address: forwarder, abi: erc2771ForwarderAbi, functionName: "nonces", args: [account] }),
          client.readContract({ address: forwarder, abi: erc2771ForwarderAbi, functionName: "eip712Domain" }),
        ]);
        if ((code && code !== "0x") || !forwarderCode || forwarderCode === "0x" || !trusted ||
          domain[3] !== BigInt(call.chainId) || !isAddressEqual(domain[4], forwarder) || domain[0] !== "0x0f" || domain[6].length) {
          throw new Error(`The canonical forwarder or ordinary wallet is unavailable on ${CHAIN_LABELS[call.chainId]}.`);
        }
        if (journal.retryNonces?.[call.chainId] !== undefined && nonce !== BigInt(journal.retryNonces[call.chainId])) {
          throw new Error("An earlier deployment authorization may have executed. Check the original destination before signing again.");
        }
        const estimate = await client.estimateGas({ account, to: call.to, data: call.data, value: BigInt(call.value),
          stateOverride: [{ address: account, balance: BigInt(call.value) + SIMULATION_BALANCE }] });
        const message = { from: account, to: call.to, value: BigInt(call.value), gas: estimate + estimate / 4n,
          nonce, deadline: relayrForwarderDeadline(), data: call.data };
        const typedDomain = { name: domain[1], version: domain[2], chainId: BigInt(call.chainId), verifyingContract: forwarder };
        onProgress(`Sign the deployment authorization for ${CHAIN_LABELS[call.chainId]}.`);
        await step(call.chainId, { status: "signing", error: undefined });
        if (!await review({ kind: "authorization", calls: [clone(call)], authorization: {
          domain: { ...typedDomain, chainId: typedDomain.chainId.toString() },
          message: { ...message, value: message.value.toString(), gas: message.gas.toString(), nonce: message.nonce.toString() },
        } })) { await step(call.chainId, { status: "pending" }); throw new Error("Deployment authorization canceled."); }
        const wallet = await walletFor(call.chainId);
        await lock.assertHeld();
        const signature = await wallet.signTypedData({ account, domain: typedDomain, types: FORWARD_REQUEST_TYPES, primaryType: "ForwardRequest", message });
        requireAccount();
        journal.signed.push({ chainId: call.chainId, nonce: nonce.toString(), deadline: message.deadline, entry: {
          chain: call.chainId, target: forwarder, value: call.value,
          data: encodeFunctionData({ abi: erc2771ForwarderAbi, functionName: "execute", args: [{ from: account, to: call.to, value: message.value,
            gas: message.gas, deadline: message.deadline, data: call.data, signature }] }),
        } });
        await step(call.chainId, { status: "pending" });
      }
      const verifySigned = async () => {
        requireAccount();
        for (const signed of journal.signed) {
          const request = requestOf(signed);
          const client = await clientFor(signed.chainId);
          await feeUnchanged(callOf(signed.chainId), client);
          const [code, trusted, nonce, valid] = await Promise.all([
            client.getCode({ address: account }),
            client.readContract({ address: request.to, abi: TRUSTED_FORWARDER_ABI, functionName: "isTrustedForwarder", args: [signed.entry.target] }),
            client.readContract({ address: signed.entry.target, abi: erc2771ForwarderAbi, functionName: "nonces", args: [account] }),
            client.readContract({ address: signed.entry.target, abi: erc2771ForwarderAbi, functionName: "verify", args: [request] }),
          ]);
          if ((code && code !== "0x") || !trusted || !valid || nonce !== BigInt(signed.nonce) || request.deadline < Math.floor(Date.now() / 1000) + 120) {
            throw new Error("A saved authorization or wallet changed or expired. Check the original deployment before continuing.");
          }
          await simulate(client, { chainId: signed.chainId, to: signed.entry.target, data: signed.entry.data, value: signed.entry.value, label: "Verify deployment authorization" },
            request.gas + request.gas / 63n + 100_000n, true);
        }
      };
      // ponytail: a late superseded success on one chain holds the remaining retry here until its deadline; upgrade path: rebuild the unpaid retry for unfinished chains.
      try { await verifySigned(); }
      catch (error) { throw heldUntil === null ? error : new Error(heldMessage(heldUntil), { cause: error }); }

      const requestQuote = async () => {
        await save({ type: "quoting" }); // The exact signed entries are durable before Relayr sees them.
        onProgress("Getting Relayr payment options for every selected chain.");
        const request = relayrBundleRequest(journal.signed.map(item => item.entry));
        const response = await fetch(`${RELAYR_API}/v1/bundle/prepaid`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request), cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(45_000) });
        await save({ type: "quoted", quote: await bindRelayrQuote(response, request) });
      };
      const destinations = journal.signed.map(item => item.chainId);
      let payment: RelayrPayment | undefined;
      if (journal.phase === "payment-reverted") {
        // A quote paid before is paid again with exactly the option it used, once the SDK's retry rule clears it.
        requireQuoteBindings();
        payment = relayrRetryOption(journal.payments, journal.quote?.payment_info);
      } else {
        if (!journal.quote) await requestQuote();
        requireQuoteBindings();
        let payments = relayrPaymentOptions(journal.quote!, destinations);
        if (!payments.length) {
          // The known quote was never paid: refresh only its SAME signed calls, then ask again.
          await requestQuote();
          requireQuoteBindings();
          payments = relayrPaymentOptions(journal.quote!, destinations);
        }
        if (!payments.length) throw new Error("Relayr returned no usable payment options. Keep the original deployment for recovery.");
        onProgress("Choose a quoted funding chain for one deployment payment.");
        const selectedChain = await chooseFunding(payments.map(option => ({ chainId: option.chain, label: paymentLabel(option) })));
        if (selectedChain === null) throw new Error("Deployment payment canceled before sending.");
        payment = payments.find(option => option.chain === selectedChain);
        if (!payment) throw new Error("The chosen chain is not offered by this Relayr quote.");
      }
      const quote = journal.quote!;
      const details = relayrPaymentDetails(payment, { bundleUuid: quote.bundle_uuid, destinationChainIds: destinations, expectedTransactions: quote.expectedTransactions });
      const paid = journal.payments ?? [];
      const paymentCall: MachineDeployCall = { chainId: details.chainId, to: details.target, data: details.calldata, value: details.amount.toString(),
        label: journal.superseded?.length || paid.length ? "Retry unsuccessful destinations. A previous payment may already have been charged." : "One Relayr deployment payment" };
      const client = await clientFor(details.chainId);
      const verifyPayment = async () => {
        requireAccount(); requireQuoteBindings();
        await requireRelayrPaymentRuntime(client);
        await simulateRelayrPayment(client, { from: account, payment: details });
        if (paid.length) await requireRelayrRetry(chainClient, { payments: paid, from: account, bundleUuid: details.bundleUuid });
        await verifySigned();
      };
      await verifyPayment();
      if (!await review({ kind: "payment", calls: [clone(paymentCall)] })) throw new Error("Deployment payment canceled before sending.");
      const wallet = await walletFor(details.chainId);
      await verifyPayment();
      await save({ type: "chosen", paymentChainId: details.chainId, paymentDeadline: details.deadline.toString() });
      await save({ type: "sending" }); // Durable BEFORE the wallet may send, including its no-hash window. Fenced, with no await before the wallet.
      /**
       * An outcome this payment returned, kept for a fresh lock while the saved
       * journal is still exactly as this attempt last saved it (same deployment,
       * quote, phase and payments). Call it before `save` advances the journal.
       */
      const keep = (event: LaunchEvent) => {
        const phase = journal.phase, payments = JSON.stringify(journal.payments ?? []);
        return (saved: MachineDeploySession) => {
          const target = saved.id === current.id ? saved.relayr : undefined;
          if (target?.phase !== phase || target.quote?.bundle_uuid !== quote.bundle_uuid ||
            JSON.stringify(target.payments ?? []) !== payments) return undefined;
          return advanceRelayrLaunch(target, event) ? saved : undefined;
        };
      };
      onProgress(`Approve one Relayr payment on ${CHAIN_LABELS[details.chainId]}.`);
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: details.target, data: details.calldata, value: details.amount, gas: RELAYR_PAYMENT_GAS });
      } catch (error) {
        const outcome = relayrPaymentAttemptOutcome(error, { sending: true, paid: paid.length > 0 });
        const unsent: LaunchEvent = { type: "unsent", outcome };
        // A lost lock leaves the outcome to the fresh-lock reconcile; the caller still learns why nothing was sent.
        await save(unsent, keep(unsent)).catch(saveError => { if (!(saveError instanceof LockLostError)) throw saveError; });
        if (outcome) throw error;
        throw new Error(NO_HASH, { cause: error });
      }
      const sent: LaunchEvent = { type: "sent", payments: [...paid, sentRelayrPayment(details, hash)] };
      await save(sent, keep(sent));
      try {
        const mined = (await client.waitForTransactionReceipt({ hash, timeout: 120_000 })).transactionHash ?? hash;
        // A sped-up payment is mined under another hash at the same nonce: it replaces the dropped one, which can never mine.
        if (mined.toLowerCase() !== hash.toLowerCase()) {
          const replaced: LaunchEvent = { type: "sent", payments: [...paid, sentRelayrPayment(details, mined)] };
          await save(replaced, keep(replaced));
        }
        await verifyRelayrPayment(client, { hash: mined, from: account, payment: details });
      } catch (error) {
        if (error instanceof RelayrPaymentRevertedError) await save({ type: "reverted" });
        throw error instanceof RelayrProofError ? error : new Error("The original Relayr payment could not be confirmed. Do not pay again.", { cause: error });
      }
      await save({ type: "executing" });
      onProgress("Payment confirmed. Checking each destination deployment onchain.");
      try { await readRecords(pollRelayrBundle(quote.bundle_uuid, journal.signed.length)); }
      catch {
        // A failed or slow bundle is still reconciled from its exact receipts.
        try { await readRecords(readRelayrBundle(quote.bundle_uuid)); }
        catch { /* Relayr's availability never proves deployment or failure. */ }
      }
      if (await reconcile()) return;
      throw new Error(journal.quote === quote
        ? "Relayr is still being checked. Resume the saved deployment to check its original transactions without paying again."
        : "Some destinations did not deploy. Resume to review a new quote for only those chains.");
    }
  }
}
