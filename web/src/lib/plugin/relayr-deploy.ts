import { JBCoreContracts, erc2771ForwarderAbi, getJBContractAddress, jbProjectsAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { getAccount, getPublicClient, getWalletClient, switchChain, type Config } from "@wagmi/core";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, isAddressEqual, keccak256, numberToHex,
  parseAbi, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { assertSupportedChainId, CHAIN_LABELS } from "@/lib/chains";
import { buildDeployArgs, buildPitchUri, deployerFor, projectsFor } from "@/lib/plugin/deploy";
import { loadMachineDeployment, MACHINE_DEPLOY_LOCK, machineDeploymentFingerprint, saveMachineDeployment,
  type MachineDeployAuthorization, type MachineDeployCall, type MachineDeployRelayrAttempt, type MachineDeploySession, type MachineDeployStep } from "@/lib/plugin/deploy-session";
import type { MachineDraft } from "@/lib/plugin/types";
import { bindRelayrQuote, fetchRelayrStatus, isRelayrChainSet, paymentDetails, paymentLabel, postRelayrBundle,
  relayrDestinationHash, relayrPaymentOptions, RELAYR_PAYMENT_ADDRESS, RELAYR_PAYMENT_CODE_HASH,
  RELAYR_PAYMENT_CODE_MAX_BYTES, RELAYR_PAYMENT_GAS } from "@/lib/plugin/relayr-protocol";

const TRUSTED_FORWARDER_ABI = parseAbi(["function isTrustedForwarder(address forwarder) view returns (bool)"]);
const SAFE_EXECUTE_ABI = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)"]);
const FORWARD_REQUEST_TYPES = { ForwardRequest: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
] } as const;
const DEADLINE_SECONDS = 47 * 60 * 60;
const SIMULATION_BALANCE = 100n * 10n ** 18n;
const activeDeployments = new Set<string>();

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
function walletRejected(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (item.code === 4001 || item.name === "UserRejectedRequestError") return true;
    current = item.cause;
  }
  return false;
}
function forwarderFor(chainId: number): Address {
  return getJBContractAddress(JBCoreContracts.ERC2771Forwarder, 6, assertSupportedChainId(chainId));
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
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("This browser needs Web Locks to safely coordinate deployments across tabs.");
  if (activeDeployments.has(MACHINE_DEPLOY_LOCK)) throw new Error("This deployment is already running.");
  activeDeployments.add(MACHINE_DEPLOY_LOCK);
  try {
    return await navigator.locks.request(MACHINE_DEPLOY_LOCK, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("This deployment is already running in another tab.");
      return run();
    });
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

  async function run(): Promise<MachineDeploySession> {
    requireAccount();
    let session = loadMachineDeployment();
    if (!session) {
      if (!draft || manual === undefined) throw new Error("Configure a machine before deploying.");
      const frozenDraft = clone(draft);
      if (!isRelayrChainSet(frozenDraft.chainIds)) throw new Error("Choose unique supported chains from the same network environment.");
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
        version: 1, id: salt, account, salt, startsAtOrAfter, pitchUri, transport, phase: "prepared",
        draft: frozenDraft, manual, calls,
        steps: calls.map(call => ({ chainId: call.chainId, label: CHAIN_LABELS[call.chainId] ?? String(call.chainId), status: "pending" })),
        ...(transport === "relayr" ? { relayr: { signed: [], records: [] } } : {}),
      };
      session = { ...prepared, fingerprint: machineDeploymentFingerprint(prepared) };
    }
    const current = session;
    if (!isAddressEqual(current.account, account)) throw new Error("Connect the wallet that started this deployment.");
    function persist() {
      // Preserve a just-returned wallet hash in the visible recovery state even
      // if storage fails. The earlier durable no-hash marker still blocks replay.
      try { saveMachineDeployment(current); } finally { onSession(clone(current)); }
    }
    function step(chainId: number, next: Partial<MachineDeployStep>) {
      const item = current.steps.find(item => item.chainId === chainId);
      if (!item) throw new Error("The saved deployment chain changed.");
      Object.assign(item, next);
      persist();
    }
    persist();
    if (current.phase === "done") return clone(current);
    if (current.transport === "direct") {
      try { await runDirect(); }
      catch (error) {
        if (current.steps.some(item => item.status === "signing")) {
          current.steps.forEach(item => { if (item.status === "signing") item.status = "pending"; });
          persist();
        }
        throw error;
      }
    } else await runRelayr();
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
        step(call.chainId, { status: "failed", hash, error: "Deployment reverted onchain." });
        return false;
      }
      const projectId = machineProjectIdFromReceipt(receipt, call, account);
      step(call.chainId, { status: "done", hash, projectId, error: undefined });
      return true;
    }

    async function requireFinalizedReceipt(chainId: number, hash: Hex, expectedStatus: "success" | "reverted") {
      const client = await clientFor(chainId);
      const receipt = await client.getTransactionReceipt({ hash });
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (receipt.status !== expectedStatus || receipt.transactionHash !== hash || finalized.number < receipt.blockNumber ||
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash ||
        (await client.getBlock({ blockNumber: finalized.number })).hash !== finalized.hash) {
        throw new Error("The original transaction is not finalized. Check it again before retrying this deployment.");
      }
    }

    async function runDirect() {
      current.phase = "executing";
      persist();
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
          if (reportedHash && reportedHash !== suppliedHash) step(call.chainId, { reportedHash });
          continue;
        }
        if (status.hash) {
          onProgress(`Checking the saved deployment on ${CHAIN_LABELS[call.chainId]}.`);
          try {
            if (await verifyReceipt(call, status.hash)) continue;
          } catch (error) {
            step(call.chainId, { status: "uncertain", error: errorMessage(error) });
            throw new Error("The saved transaction is unresolved. Check wallet activity before deploying again.");
          }
          // A canonical reverted transaction may be retried with the identical
          // pinned call. Its salt and start time are never regenerated.
          await requireFinalizedReceipt(call.chainId, status.hash, "reverted");
          step(call.chainId, { hash: undefined, status: "pending", error: undefined });
        } else if (status.status === "uncertain" || status.status === "confirming") {
          throw new Error("Your wallet may have sent this deployment without returning its hash. Check its activity; do not deploy again.");
        }
        requireAccount();
        const client = await clientFor(call.chainId);
        await feeUnchanged(call, client);
        step(call.chainId, { status: "signing", error: undefined });
        const estimate = await client.estimateGas({ account, to: call.to, data: call.data, value: BigInt(call.value) });
        const gas = estimate + estimate / 4n;
        await simulate(client, call, gas, false);
        if (!await review({ kind: "transaction", calls: [clone(call)] })) {
          step(call.chainId, { status: "pending" });
          throw new Error("Deployment canceled before sending.");
        }
        const wallet = await walletFor(call.chainId);
        await feeUnchanged(call, client);
        await simulate(client, call, gas, false);
        requireAccount();
        step(call.chainId, { status: "uncertain", error: "Waiting for the wallet to return the deployment hash." });
        let hash: Hex;
        try {
          hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: call.to, data: call.data, value: BigInt(call.value), gas });
        } catch (error) {
          if (walletRejected(error)) step(call.chainId, { status: "pending", error: "You canceled in your wallet." });
          else throw new Error("Your wallet may have sent the deployment without returning its hash. Check its activity; do not deploy again.", { cause: error });
          throw error;
        }
        step(call.chainId, { status: "confirming", hash, error: undefined });
        onProgress(`Confirming deployment on ${CHAIN_LABELS[call.chainId]}.`);
        try {
          await client.waitForTransactionReceipt({ hash, timeout: 120_000, onReplaced: () => {
            throw new Error("The wallet replaced this transaction. Keep the original hash and check the saved deployment.");
          } });
          if (!await verifyReceipt(call, hash)) throw new Error("Deployment reverted onchain. Resume to review the same deployment again.");
        } catch (error) {
          if (current.steps.find(item => item.chainId === call.chainId)!.status !== "failed") {
            step(call.chainId, { status: "uncertain", error: errorMessage(error) });
          }
          throw error;
        }
      }
      current.phase = "done";
      persist();
      onProgress("The machine is deployed on every selected chain.");
    }

    async function runRelayr() {
      const journal = current.relayr!;
      if (!isRelayrChainSet(current.calls.map(call => call.chainId)) || current.calls.length < 2) throw new Error("The saved Relayr destinations are invalid.");
      const requestOf = (signed: MachineDeployAuthorization) => {
        const call = current.calls.find(call => call.chainId === signed.chainId);
        if (!call || signed.entry.chain !== signed.chainId || !isAddressEqual(signed.entry.target, forwarderFor(signed.chainId)) ||
          !/^(0|[1-9][0-9]*)$/u.test(signed.nonce) || signed.entry.value !== call.value) throw new Error("The saved deployment authorization changed.");
        const decoded = decodeFunctionData({ abi: erc2771ForwarderAbi, data: signed.entry.data });
        if (decoded.functionName !== "execute") throw new Error("The saved authorization is not a forwarder execution.");
        const request = decoded.args[0];
        if (!isAddressEqual(request.from, account) || !isAddressEqual(request.to, call.to) || request.data.toLowerCase() !== call.data.toLowerCase() ||
          request.value !== BigInt(call.value) || request.deadline !== signed.deadline || request.gas <= 0n) {
          throw new Error("The saved authorization does not match this machine.");
        }
        return request;
      };
      for (const attempt of [...(journal.history ?? []), journal]) for (const signed of attempt.signed) requestOf(signed);
      const verifySigned = async () => {
        requireAccount();
        for (const signed of journal.signed) {
          const request = requestOf(signed);
          const client = await clientFor(signed.chainId);
          await feeUnchanged(current.calls.find(call => call.chainId === signed.chainId)!, client);
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
      const requireQuoteBindings = (quote = journal.quote, signedEntries = journal.signed) => {
        const bindings = quote?.expectedTransactions;
        if (!bindings || bindings.length !== signedEntries.length || new Set(bindings.map(binding => binding.txUuid)).size !== bindings.length ||
          new Set(bindings.map(binding => binding.chain)).size !== bindings.length || signedEntries.some(signed => {
            const binding = bindings.find(binding => binding.chain === signed.chainId);
            return !binding || semantic(binding.entry) !== semantic(signed.entry);
          })) throw new Error("The saved quote does not bind every exact deployment authorization.");
        return bindings;
      };
      const checkExpired = async () => {
        const attempts = [...(journal.history ?? []), journal];
        const authorizations = attempts.flatMap(attempt => attempt.signed);
        if (!authorizations.length || current.steps.some(step => step.status === "done")) return false;
        for (const signed of authorizations) {
          const client = await clientFor(signed.chainId);
          const block = await client.getBlock({ blockTag: "finalized" });
          const nonce = await client.readContract({ address: signed.entry.target, abi: erc2771ForwarderAbi, functionName: "nonces", args: [account], blockNumber: block.number });
          if (block.timestamp <= BigInt(signed.deadline) || nonce !== BigInt(signed.nonce) ||
            (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) return false;
        }
        for (const attempt of attempts.filter(attempt => attempt.paymentStarted)) {
          if (!attempt.payment || !attempt.quote) return false;
          const details = paymentDetails(attempt.payment, attempt.quote.bundle_uuid, { allowExpired: true });
          const client = await clientFor(details.chainId);
          const block = await client.getBlock({ blockTag: "finalized" });
          if (block.timestamp <= details.deadline || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) return false;
        }
        journal.abandonable = true;
        current.steps.forEach(item => { item.status = "failed"; item.error = "The unused deployment authorization expired."; });
        persist();
        return true;
      };
      const reconcile = async () => {
        const attempts = [...(journal.history ?? []), journal];
        for (const attempt of attempts) {
          for (const quote of [...(attempt.previousQuotes ?? []), ...(attempt.quote ? [attempt.quote] : [])]) {
            requireQuoteBindings(quote, attempt.signed);
            try {
              const records = await fetchRelayrStatus(quote);
              const ids = new Set(quote.expectedTransactions.map(item => item.txUuid));
              attempt.records = [...attempt.records.filter(record => !ids.has(record.tx_uuid)), ...records];
              persist();
            } catch { /* HTTP availability and provider labels never prove deployment or failure. */ }
          }
        }
        for (const call of current.calls) {
          const status = current.steps.find(item => item.chainId === call.chainId)!;
          if (status.status === "done") continue;
          const candidates = attempts.flatMap(attempt => {
            const signed = attempt.signed.find(item => item.chainId === call.chainId);
            if (!signed) return [];
            const bindings = [...(attempt.previousQuotes ?? []), ...(attempt.quote ? [attempt.quote] : [])]
              .flatMap(quote => requireQuoteBindings(quote, attempt.signed));
            const ids = new Set(bindings.filter(item => item.chain === call.chainId).map(item => item.txUuid));
            const records = attempt.records.filter(record => ids.has(record.tx_uuid));
            if (new Set(records.map(record => record.tx_uuid)).size !== records.length) throw new Error("Relayr returned conflicting transaction records.");
            return [...new Set([...(status.hash ? [status.hash] : []), ...records.flatMap(record => relayrDestinationHash(record) ?? [])])]
              .map(hash => ({ signed, hash }));
          });
          if (!candidates.length) { step(call.chainId, { status: "uncertain", error: "Waiting for the original destination transaction." }); continue; }
          for (const { signed, hash } of candidates) {
            try {
              if (await verifyReceipt(call, hash,
                { to: signed.entry.target, data: signed.entry.data, value: signed.entry.value })) break;
            } catch (error) { step(signed.chainId, { status: "uncertain", hash, error: errorMessage(error) }); }
          }
        }
        if (current.steps.every(step => step.status === "done")) {
          current.phase = "done"; persist(); onProgress("The machine is deployed on every selected chain."); return true;
        }
        return false;
      };
      const prepareFailedRetry = async () => {
        // Unknown funding outcomes are never replaced with another charge.
        if (journal.paymentStarted) {
          if (!journal.paymentHash || !journal.payment || !journal.quote) return false;
          const details = paymentDetails(journal.payment, journal.quote.bundle_uuid, { allowExpired: true });
          const paymentClient = await clientFor(details.chainId);
          const [paymentTx, paymentReceipt] = await Promise.all([
            paymentClient.getTransaction({ hash: journal.paymentHash }), paymentClient.getTransactionReceipt({ hash: journal.paymentHash }),
          ]);
          if (!paymentTx.to || !isAddressEqual(paymentTx.to, details.target) || !isAddressEqual(paymentTx.from, account) ||
            paymentTx.input.toLowerCase() !== details.calldata.toLowerCase() || paymentTx.value !== details.amount ||
            paymentTx.hash !== journal.paymentHash || paymentTx.chainId !== details.chainId || paymentTx.blockHash !== paymentReceipt.blockHash ||
            paymentTx.blockNumber !== paymentReceipt.blockNumber) return false;
          await requireFinalizedReceipt(details.chainId, journal.paymentHash, paymentReceipt.status);
        } else if (!journal.published) return false;
        const retryNonces: Record<number, string> = {};
        for (const call of current.calls) {
          const status = current.steps.find(item => item.chainId === call.chainId)!;
          if (status.status === "done") {
            await requireFinalizedReceipt(call.chainId, status.hash!, "success");
            continue;
          }
          const signed = journal.signed.find(item => item.chainId === call.chainId);
          if (!signed) return false;
          const client = await clientFor(call.chainId);
          const block = await client.getBlock({ blockTag: "finalized" });
          const nonce = await client.readContract({ address: signed.entry.target, abi: erc2771ForwarderAbi,
            functionName: "nonces", args: [account], blockNumber: block.number });
          if (nonce !== BigInt(signed.nonce) || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) return false;
          if (status.status === "failed" && status.hash) await requireFinalizedReceipt(call.chainId, status.hash, "reverted");
          else if (block.timestamp <= BigInt(signed.deadline)) return false;
          // Every previous signature for this destination retains this SAME
          // nonce. Even a delayed old execution can only win once.
          if ((journal.history ?? []).flatMap(attempt => attempt.signed).some(item => item.chainId === call.chainId && item.nonce !== signed.nonce)) return false;
          retryNonces[call.chainId] = signed.nonce;
        }
        if (!Object.keys(retryNonces).length) return false;
        const previous: MachineDeployRelayrAttempt = clone({ signed: journal.signed, published: journal.published,
          unboundQuote: journal.unboundQuote, quote: journal.quote, previousQuotes: journal.previousQuotes,
          records: journal.records, payment: journal.payment, paymentHash: journal.paymentHash,
          paymentStarted: journal.paymentStarted, paymentConfirmed: journal.paymentConfirmed });
        journal.history = [...(journal.history ?? []), previous];
        journal.signed = []; journal.records = []; journal.retryNonces = retryNonces;
        delete journal.published; delete journal.unboundQuote; delete journal.quote; delete journal.previousQuotes;
        delete journal.payment; delete journal.paymentHash; delete journal.paymentStarted; delete journal.paymentConfirmed; delete journal.abandonable;
        current.steps.forEach(item => { if (item.status !== "done") { item.status = "pending"; delete item.hash; delete item.error; } });
        current.phase = "signing"; persist();
        onProgress("Retrying only verified unsuccessful destinations. The previous payment may already have been charged; review a new quote for these chains.");
        return true;
      };

      if (journal.published && !journal.quote && journal.unboundQuote) {
        onProgress("Recovering the original Relayr quote.");
        try {
          journal.quote = await bindRelayrQuote(journal.unboundQuote, journal.signed.map(item => item.entry));
          current.phase = "quoted"; persist();
        } catch (error) {
          // A unavailable status endpoint cannot prevent finalized onchain
          // expiry proofs from safely releasing unused authorizations.
          let retryable = false;
          try { retryable = await prepareFailedRetry(); } catch { /* Preserve the binding error if RPC is unavailable. */ }
          if (!retryable) {
            try { await checkExpired(); } catch { /* Preserve the binding error if RPC is unavailable. */ }
            throw error;
          }
        }
      }
      if (journal.paymentStarted || (journal.published && !journal.quote)) {
        onProgress("Checking the original payment and destination deployments.");
        if (await reconcile()) return;
        if (!await prepareFailedRetry()) {
          let expired = false;
          try { expired = await checkExpired(); } catch { /* Unavailable RPC cannot prove expiration. */ }
          current.phase = "unresolved"; persist();
          throw new Error(expired
            ? "The unused deployment authorizations expired. You may abandon this attempt. An earlier payment may still have been charged; check your wallet."
            : "The original deployment is unresolved. Check its saved transactions; do not pay or deploy again.");
        }
      }
      if (journal.published && journal.quote) {
        // Published calls can execute independently of provider payment labels.
        if (await reconcile()) return;
        if (current.steps.some(step => journal.signed.some(item => item.chainId === step.chainId) && (step.status === "done" || step.hash))) {
          if (!await prepareFailedRetry()) throw new Error("Some published deployments may have executed. Check the original bundle before paying.");
        } else if (journal.history?.length) {
          // An expired unfunded retry also preserves completed chains. Its
          // finalized unchanged nonce permits a replacement authorization.
          await prepareFailedRetry();
        }
        let expired = false;
        try { expired = await checkExpired(); } catch { /* Revalidation below fails safely if the RPC remains unavailable. */ }
        if (expired) throw new Error("The unused deployment authorizations expired. Abandon this saved attempt before configuring a new machine.");
      }
      current.phase = "signing"; persist();
      for (const call of current.calls) {
        if (current.steps.find(item => item.chainId === call.chainId)?.status === "done") continue;
        if (journal.signed.some(signed => signed.chainId === call.chainId)) continue;
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
          nonce, deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS, data: call.data };
        const typedDomain = { name: domain[1], version: domain[2], chainId: BigInt(call.chainId), verifyingContract: forwarder };
        onProgress(`Sign the deployment authorization for ${CHAIN_LABELS[call.chainId]}.`);
        step(call.chainId, { status: "signing", error: undefined });
        if (!await review({ kind: "authorization", calls: [clone(call)], authorization: {
          domain: { ...typedDomain, chainId: typedDomain.chainId.toString() },
          message: { ...message, value: message.value.toString(), gas: message.gas.toString(), nonce: message.nonce.toString() },
        } })) { step(call.chainId, { status: "pending" }); throw new Error("Deployment authorization canceled."); }
        const wallet = await walletFor(call.chainId);
        const signature = await wallet.signTypedData({ account, domain: typedDomain, types: FORWARD_REQUEST_TYPES, primaryType: "ForwardRequest", message });
        requireAccount();
        journal.signed.push({ chainId: call.chainId, nonce: nonce.toString(), deadline: message.deadline, entry: {
          chain: call.chainId, target: forwarder, value: call.value, virtual_nonce: 0,
          data: encodeFunctionData({ abi: erc2771ForwarderAbi, functionName: "execute", args: [{ from: account, to: call.to, value: message.value,
            gas: message.gas, deadline: message.deadline, data: call.data, signature }] }),
        } });
        step(call.chainId, { status: "pending" });
      }
      await verifySigned();
      const requestQuote = async () => {
        if (journal.quote) {
          journal.previousQuotes = [...(journal.previousQuotes ?? []), journal.quote];
          delete journal.quote;
          delete journal.unboundQuote;
        }
        current.phase = "quoting"; journal.published = true;
        persist(); // If POST or its response is lost, exact signatures remain recoverable.
        onProgress("Getting Relayr payment options for every selected chain.");
        journal.quote = await postRelayrBundle(journal.signed.map(item => item.entry), unbound => { journal.unboundQuote = clone(unbound); persist(); });
        current.phase = "quoted"; persist();
      };
      if (!journal.quote) await requestQuote();
      requireQuoteBindings();
      let payments = relayrPaymentOptions(journal.quote!, current.calls.map(call => call.chainId));
      if (!payments.length) {
        // The known quote was never paid. Refresh only its SAME signed calls;
        // retain its UUID for recovery and require another explicit choice.
        await requestQuote();
        requireQuoteBindings();
        payments = relayrPaymentOptions(journal.quote!, current.calls.map(call => call.chainId));
      }
      if (!payments.length) throw new Error("Relayr returned no usable payment options. Keep the original deployment for recovery.");
      onProgress("Choose a quoted funding chain for one deployment payment.");
      const selectedChain = await chooseFunding(payments.map(payment => ({ chainId: payment.chain, label: paymentLabel(payment) })));
      if (selectedChain === null) throw new Error("Deployment payment canceled before sending.");
      const selected = payments.find(payment => payment.chain === selectedChain);
      if (!selected) throw new Error("The chosen chain is not offered by this Relayr quote.");
      const payment = clone(selected);
      const details = paymentDetails(payment, journal.quote!.bundle_uuid);
      const paymentCall: MachineDeployCall = { chainId: details.chainId, to: details.target, data: details.calldata, value: details.amount.toString(),
        label: journal.history?.length ? "Retry unsuccessful destinations. A previous payment may already have been charged." : "One Relayr deployment payment" };
      const client = await clientFor(details.chainId);
      const verifyPayment = async () => {
        requireAccount(); requireQuoteBindings();
        if (semantic(paymentDetails(payment, journal.quote!.bundle_uuid)) !== semantic(details)) throw new Error("The reviewed Relayr payment changed.");
        const code = await client.getCode({ address: RELAYR_PAYMENT_ADDRESS });
        if (!code || code === "0x" || (code.length - 2) / 2 > RELAYR_PAYMENT_CODE_MAX_BYTES || keccak256(code) !== RELAYR_PAYMENT_CODE_HASH) {
          throw new Error("The Relayr payment contract does not match its verified runtime.");
        }
        if (await simulate(client, paymentCall, RELAYR_PAYMENT_GAS, false) !== "0x") throw new Error("The Relayr payment simulation returned unexpected data.");
        await verifySigned();
      };
      await verifyPayment();
      if (!await review({ kind: "payment", calls: [clone(paymentCall)] })) throw new Error("Deployment payment canceled before sending.");
      const wallet = await walletFor(details.chainId);
      await verifyPayment();
      journal.payment = payment; journal.paymentStarted = true; current.phase = "payment-signing";
      persist(); // Durable BEFORE the wallet may send, including its no-hash window.
      onProgress(`Approve one Relayr payment on ${CHAIN_LABELS[details.chainId]}.`);
      try {
        journal.paymentHash = await wallet.sendTransaction({ account, chain: wallet.chain, to: details.target, data: details.calldata, value: details.amount, gas: RELAYR_PAYMENT_GAS });
      } catch (error) {
        if (walletRejected(error)) { delete journal.paymentStarted; delete journal.payment; current.phase = "quoted"; persist(); }
        else {
          current.phase = "unresolved"; persist();
          throw new Error("Your wallet may have sent the Relayr payment without returning its hash. Check its activity; do not pay again.", { cause: error });
        }
        throw error;
      }
      current.phase = "executing"; persist();
      try {
        await client.waitForTransactionReceipt({ hash: journal.paymentHash, timeout: 120_000 });
        const [tx, receipt] = await Promise.all([client.getTransaction({ hash: journal.paymentHash }), client.getTransactionReceipt({ hash: journal.paymentHash })]);
        if (!tx.to || !isAddressEqual(tx.to, details.target) || !isAddressEqual(tx.from, account) || tx.input !== details.calldata ||
          tx.value !== details.amount || tx.chainId !== details.chainId || tx.hash !== journal.paymentHash || receipt.transactionHash !== journal.paymentHash ||
          tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash || receipt.status !== "success") {
          throw new Error("The original Relayr payment could not be confirmed. Do not pay again.");
        }
        journal.paymentConfirmed = true; persist();
      } catch (error) { current.phase = "unresolved"; persist(); throw error; }
      onProgress("Payment confirmed. Checking each destination deployment onchain.");
      for (let attempt = 0; attempt < 24; attempt++) {
        if (await reconcile()) return;
        if (current.steps.every(step => step.status === "done" || step.status === "failed")) break;
        await new Promise(resolve => setTimeout(resolve, 2_500));
      }
      current.phase = "unresolved"; persist();
      throw new Error("Relayr is still being checked. Resume the saved deployment to check its original transactions without paying again.");
    }
  }
}
