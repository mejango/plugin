import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JBCoreContracts, getJBContractAddress, jbProjectsAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAbiItem, parseAbi, zeroAddress, zeroHash, type AbiEvent, type Address, type Hex, type TransactionReceipt } from "viem";
import type { Config } from "@wagmi/core";
import { buildDeployArgs, projectsFor } from "@/lib/plugin/deploy";
import { canClearMachineDeployment, loadMachineDeployment, type MachineDeploySession } from "@/lib/plugin/deploy-session";
import { machineProjectIdFromReceipt, runMachineDeployment, type MachineDeployReview } from "@/lib/plugin/relayr-deploy";
import { RELAYR_NATIVE_TOKEN, RELAYR_PAYMENT_ADDRESS, RELAYR_PAYMENT_SELECTOR, type RelayrEntry, type RelayrPayment, type RelayrQuote, type RelayrUnboundQuote } from "@/lib/plugin/relayr-protocol";
import type { MachineDraft } from "@/lib/plugin/types";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(), getPublicClient: vi.fn(), getWalletClient: vi.fn(), switchChain: vi.fn(),
  post: vi.fn(), bind: vi.fn(), status: vi.fn(),
}));
vi.mock("@wagmi/core", () => ({ getAccount: mocks.getAccount, getPublicClient: mocks.getPublicClient, getWalletClient: mocks.getWalletClient, switchChain: mocks.switchChain }));
vi.mock("@/lib/plugin/relayr-protocol", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/plugin/relayr-protocol")>(),
  RELAYR_PAYMENT_CODE_HASH: (await import("viem")).keccak256("0x6000"),
  postRelayrBundle: mocks.post, bindRelayrQuote: mocks.bind, fetchRelayrStatus: mocks.status,
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const BUNDLE = "12345678-1234-4321-8123-123456789abc";
const NOW = 1_800_000_000;
const PAYMENT_HASH = `0x${"ab".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"bc".repeat(32)}` as Hex;
const destinationHash = (chain: number) => `0x${chain.toString(16).padStart(64, "0")}` as Hex;
const txUuid = (chain: number) => `${chain.toString(16).padStart(8, "0")}-1234-4321-8123-123456789abc`;
const config = {} as Config;
const originalDraft: MachineDraft = { name: "Machine", id: "machine", goal: "A shared goal", address: ACCOUNT, keepPercent: 10, doubling: "1m", routes: [], chainIds: [1, 10] };
const snapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
};
let connectedChain = 1;
let connectedAccount = ACCOUNT;
let smartAccount = false;
let mined = false;
let latest: MachineDeploySession;
let offers: RelayrPayment[];
const events: string[] = [];
const sign = vi.fn();
const send = vi.fn();
const chooseFunding = vi.fn<(options: { chainId: number; label: string }[]) => Promise<number | null>>();
const review = vi.fn<(request: MachineDeployReview) => Promise<boolean>>();
const request = vi.fn();
const readContract = vi.fn();
const getCode = vi.fn();
const onSession = vi.fn((session: MachineDeploySession) => { latest = session; });

function payment(chain = 1, bundle = BUNDLE, deadline = NOW + 600): RelayrPayment {
  return { chain, target: RELAYR_PAYMENT_ADDRESS, token: RELAYR_NATIVE_TOKEN, amount: "1000000000000000", payment_deadline: deadline,
    calldata: `${RELAYR_PAYMENT_SELECTOR}${bundle.replaceAll("-", "")}${"0".repeat(32)}${deadline.toString(16).padStart(64, "0")}` as Hex };
}
function bound(entries: RelayrEntry[], paymentInfo = offers): RelayrQuote {
  return { bundle_uuid: BUNDLE, payment_info: snapshot(paymentInfo),
    expectedTransactions: entries.map(entry => ({ txUuid: txUuid(entry.chain), chain: entry.chain, entry: snapshot(entry) })) };
}
function eventLog(event: AbiEvent, values: Record<string, unknown>, address: Address) {
  return {
    address,
    topics: encodeEventTopics({ abi: [event], eventName: event.name, args: values }),
    data: encodeAbiParameters(event.inputs.filter(input => !input.indexed), event.inputs.filter(input => !input.indexed).map(input => values[input.name!]) as never),
  };
}
function deploymentReceipt(chainId: number, changes: { caller?: Address; name?: string; createAddress?: Address; projectId?: bigint } = {}): TransactionReceipt {
  const call = latest.calls.find(call => call.chainId === chainId)!;
  const args = buildDeployArgs(latest.draft, latest.pitchUri, chainId, latest.salt, latest.startsAtOrAfter);
  const projectId = changes.projectId ?? BigInt(chainId + 100);
  const configuration = { ...args[1], description: { ...args[1].description, ...(changes.name ? { name: changes.name } : {}) } };
  const logs = [
    eventLog(getAbiItem({ abi: jbProjectsAbi, name: "Create" }), { projectId, owner: call.to, caller: call.to }, changes.createAddress ?? projectsFor(chainId)),
    eventLog(getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" }), {
      revnetId: projectId, configuration,
      terminalConfigurations: [{ terminal: getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId as 1), accountingContextsToAccept: args[2] }],
      suckerDeploymentConfiguration: args[3], rulesetConfigurations: [], encodedConfigurationHash: zeroHash, caller: changes.caller ?? ACCOUNT,
    }, call.to),
  ];
  return { transactionHash: destinationHash(chainId), blockHash: BLOCK_HASH, blockNumber: 20n, status: "success", logs } as TransactionReceipt;
}
function client(chainId: number) {
  return {
    getChainId: vi.fn(async () => chainId), getCode,
    readContract: vi.fn(async (args: { functionName: string; address: Address }) => {
      if (args.functionName === "eip712Domain") return ["0x0f", "ERC2771Forwarder", "1", BigInt(chainId), args.address, zeroHash, []];
      return readContract(args);
    }),
    estimateGas: vi.fn(async () => 400_000n), request,
    getBlock: vi.fn(async () => ({ hash: BLOCK_HASH, number: 20n, timestamp: BigInt(NOW) })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    getTransaction: vi.fn(async ({ hash }: { hash: Hex }) => {
      if (hash === PAYMENT_HASH) {
        const selected = latest.relayr!.payment!;
        return { hash, to: selected.target, from: ACCOUNT, input: selected.calldata, value: BigInt(selected.amount), chainId, blockHash: BLOCK_HASH, blockNumber: 20n };
      }
      const call = latest.calls.find(call => call.chainId === chainId)!;
      const entry = latest.relayr?.signed.find(item => item.chainId === chainId)?.entry;
      return { hash, to: entry?.target ?? call.to, from: ACCOUNT, input: entry?.data ?? call.data, value: BigInt(entry?.value ?? call.value), chainId, blockHash: BLOCK_HASH, blockNumber: 20n };
    }),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => hash === PAYMENT_HASH
      ? { transactionHash: hash, blockHash: BLOCK_HASH, blockNumber: 20n, status: "success" }
      : deploymentReceipt(chainId)),
  };
}
const run = (overrides: Partial<Parameters<typeof runMachineDeployment>[0]> = {}) => runMachineDeployment({
  config, account: ACCOUNT, draft: snapshot(originalDraft), manual: "Pinned manual", onSession, onProgress: vi.fn(), chooseFunding, review, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  sign.mockReset(); send.mockReset(); chooseFunding.mockReset(); review.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1_000);
  storage.clear(); events.length = 0;
  connectedChain = 1; connectedAccount = ACCOUNT; smartAccount = false; mined = false;
  offers = [payment(1), payment(10)];
  localStorageMock.getItem.mockImplementation(key => storage.get(key) ?? null);
  localStorageMock.setItem.mockImplementation((key, value) => { storage.set(key, value); });
  vi.stubGlobal("window", { localStorage: localStorageMock });
  vi.stubGlobal("navigator", { locks: { request: vi.fn(async (_name: string, _options: unknown, fn: (lock: object) => Promise<unknown>) => fn({})) } });
  mocks.getAccount.mockImplementation(() => ({ address: connectedAccount, chainId: connectedChain }));
  mocks.switchChain.mockImplementation(async (_config, { chainId }: { chainId: number }) => { connectedChain = chainId; });
  mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => client(chainId));
  mocks.getWalletClient.mockImplementation(async (_config, { chainId }: { chainId: number }) => ({ chain: { id: chainId }, account: { address: ACCOUNT }, getAddresses: async () => [ACCOUNT], signTypedData: sign, sendTransaction: send }));
  getCode.mockImplementation(async ({ address }: { address: Address }) => address.toLowerCase() === ACCOUNT.toLowerCase() ? smartAccount ? "0x6000" : "0x" : "0x6000");
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "creationFee" ? 100n : functionName === "nonces" ? 0n : true);
  request.mockResolvedValue("0x");
  sign.mockImplementation(async () => { events.push("sign"); return `0x${"12".repeat(65)}`; });
  send.mockImplementation(async () => { events.push("pay"); mined = true; return latest.transport === "direct" ? destinationHash(connectedChain) : PAYMENT_HASH; });
  review.mockImplementation(async ({ kind }) => { events.push(`review:${kind}`); return true; });
  chooseFunding.mockImplementation(async () => { events.push("choose"); return 1; });
  mocks.post.mockImplementation(async (entries: RelayrEntry[], onPublished: (quote: RelayrUnboundQuote) => void) => {
    events.push("quote");
    onPublished({ bundle_uuid: BUNDLE, payment_info: snapshot(offers), tx_uuids: entries.map(entry => txUuid(entry.chain)) });
    return bound(entries);
  });
  mocks.bind.mockImplementation(async (_unbound: RelayrUnboundQuote, entries: RelayrEntry[]) => bound(entries));
  mocks.status.mockImplementation(async (quote: RelayrQuote) => quote.expectedTransactions.map(binding => ({ tx_uuid: binding.txUuid, request: binding.entry,
    status: mined ? { state: "Confirmed", data: { hash: destinationHash(binding.chain) } } : { state: "Pending" } })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("machine Relayr deployment", () => {
  it("signs every destination before offering validated returned quotes and makes one payment", async () => {
    offers = [payment(10), payment(8453), payment(11155111), { ...payment(1), target: OTHER }];
    chooseFunding.mockImplementation(async options => { events.push("choose"); expect(options.map(option => option.chainId)).toEqual([10, 8453]); expect(options[0].label).toContain("0.001 ETH"); return 8453; });
    const completed = await run();
    expect(events).toEqual(["review:authorization", "sign", "review:authorization", "sign", "quote", "choose", "review:payment", "pay"]);
    expect(completed).toMatchObject({ phase: "done", transport: "relayr", relayr: { paymentConfirmed: true } });
    expect(completed.steps.map(step => step.projectId)).toEqual(["101", "110"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ chain: { id: 8453 }, to: RELAYR_PAYMENT_ADDRESS, value: 1_000_000_000_000_000n });
  });

  it("persists all exact signed requests before publishing the bundle", async () => {
    mocks.post.mockImplementation(async (entries: RelayrEntry[]) => {
      const persisted = loadMachineDeployment()!;
      expect(persisted.relayr).toMatchObject({ published: true, signed: entries.map(entry => ({ entry })) });
      expect(persisted.phase).toBe("quoting");
      throw new Error("response lost");
    });
    await expect(run()).rejects.toThrow("response lost");
    expect(chooseFunding).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("deploys all four Sepolia destinations with one quoted testnet payment", async () => {
    offers = [payment(1), payment(84532), payment(11155111)];
    chooseFunding.mockImplementation(async options => {
      expect(options.map(option => option.chainId)).toEqual([84532, 11155111]);
      return 84532;
    });
    await expect(run({ draft: { ...originalDraft, chainIds: [11155111, 11155420, 84532, 421614] } })).resolves.toMatchObject({ phase: "done" });
    expect(sign).toHaveBeenCalledTimes(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never republishes when POST may have succeeded without returning a bundle", async () => {
    mocks.post.mockRejectedValue(new Error("response lost"));
    await expect(run()).rejects.toThrow("response lost");
    await expect(run()).rejects.toThrow("original deployment is unresolved");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
  });

  it("recovers a published UUID after binding fails without reposting or resigning", async () => {
    mocks.post.mockImplementation(async (entries: RelayrEntry[], onPublished: (quote: RelayrUnboundQuote) => void) => {
      onPublished({ bundle_uuid: BUNDLE, payment_info: offers, tx_uuids: entries.map(entry => txUuid(entry.chain)) });
      throw new Error("binding unavailable");
    });
    await expect(run()).rejects.toThrow("binding unavailable");
    expect(loadMachineDeployment()?.relayr?.unboundQuote?.bundle_uuid).toBe(BUNDLE);
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(mocks.bind).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it.each(["authorization", "payment"] as const)("cancels %s review before the corresponding wallet action", async kind => {
    review.mockImplementation(async request => request.kind !== kind);
    await expect(run()).rejects.toThrow("canceled");
    expect(send).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledTimes(kind === "authorization" ? 0 : 2);
    expect(chooseFunding).toHaveBeenCalledTimes(kind === "authorization" ? 0 : 1);
  });

  it("cancels funding selection and resumes the original quote, draft, salt and start time", async () => {
    chooseFunding.mockResolvedValueOnce(null);
    await expect(run()).rejects.toThrow("payment canceled");
    const saved = snapshot(loadMachineDeployment()!);
    expect(send).not.toHaveBeenCalled();
    await run({ draft: { ...snapshot(originalDraft), name: "Changed", chainIds: [8453] }, manual: "Changed manual" });
    expect(latest).toMatchObject({ draft: saved.draft, salt: saved.salt, startsAtOrAfter: saved.startsAtOrAfter, manual: saved.manual, calls: saved.calls });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects a picker choice absent from the returned options", async () => {
    chooseFunding.mockResolvedValue(8453);
    await expect(run()).rejects.toThrow("not offered");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not expose a selector when all returned offers are invalid", async () => {
    offers = [{ ...payment(), target: OTHER }, payment(11155111)];
    await expect(run()).rejects.toThrow("no usable payment options");
    expect(chooseFunding).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("pins payment state before sending and never pays again after an unknown no-hash result", async () => {
    send.mockImplementation(async () => {
      expect(loadMachineDeployment()?.relayr).toMatchObject({ paymentStarted: true, payment: payment(1) });
      throw new Error("wallet disconnected after send");
    });
    await expect(run()).rejects.toThrow("without returning its hash");
    await expect(run()).rejects.toThrow("original deployment is unresolved");
    expect(send).toHaveBeenCalledTimes(1);
    expect(chooseFunding).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("allows review of the same quote after an explicit wallet rejection", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: 4001 }));
    await expect(run()).rejects.toThrow("rejected");
    expect(loadMachineDeployment()?.relayr?.paymentStarted).toBeUndefined();
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("checks a no-hash payment's original destination transactions without paying again", async () => {
    send.mockImplementation(async () => { mined = true; throw new Error("wallet response lost"); });
    await expect(run()).rejects.toThrow("without returning its hash");
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(chooseFunding).toHaveBeenCalledTimes(1);
  });

  it("rejects destination hashes whose transaction does not contain the exact saved call", async () => {
    send.mockRejectedValue(new Error("wallet response lost"));
    await expect(run()).rejects.toThrow("without returning its hash");
    mined = true;
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const original = rpc.getTransaction.getMockImplementation()!;
      rpc.getTransaction.mockImplementation(async args => ({ ...await original(args), input: "0x1234" }));
      return rpc;
    });
    await expect(run()).rejects.toThrow("original deployment is unresolved");
    expect(loadMachineDeployment()?.steps.every(step => step.status === "uncertain")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects a payment runtime mismatch before review or wallet send", async () => {
    getCode.mockImplementation(async ({ address }: { address: Address }) => address.toLowerCase() === ACCOUNT.toLowerCase() ? "0x" : address.toLowerCase() === RELAYR_PAYMENT_ADDRESS ? "0x6001" : "0x6000");
    await expect(run()).rejects.toThrow("verified runtime");
    expect(review.mock.calls.some(([request]) => request.kind === "payment")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rechecks the account after payment review before opening the wallet", async () => {
    review.mockImplementation(async request => { if (request.kind === "payment") connectedAccount = OTHER; return true; });
    await expect(run()).rejects.toThrow("wallet that started");
    expect(send).not.toHaveBeenCalled();
  });

  it("requires the original account when restoring a deployment", async () => {
    chooseFunding.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("canceled");
    connectedAccount = OTHER;
    await expect(run({ account: OTHER })).rejects.toThrow("wallet that started");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["unreadable", "blocked", "silent write loss"])("blocks wallet actions when recovery storage is %s", async failure => {
    if (failure === "unreadable") storage.set("plugin-machine-deployment-v1", "{");
    if (failure === "blocked") localStorageMock.getItem.mockImplementation(() => { throw new Error("blocked"); });
    if (failure === "silent write loss") localStorageMock.setItem.mockImplementation(() => {});
    await expect(run()).rejects.toThrow(/saved deployment|browser storage|recovery/u);
    expect(sign).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
  });

  it("rejects tampered saved calls before another wallet action", async () => {
    chooseFunding.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("canceled");
    const saved = loadMachineDeployment()!;
    saved.calls[0].value = "200";
    storage.set("plugin-machine-deployment-v1", JSON.stringify(saved));
    await expect(run()).rejects.toThrow("saved deployment is invalid");
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("does not open a wallet when another tab holds the deployment lock", async () => {
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, fn: (lock: null) => Promise<unknown>) => fn(null) } });
    await expect(run()).rejects.toThrow("another tab");
    expect(sign).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("keeps single-chain deployments direct and never resends a no-hash attempt", async () => {
    send.mockRejectedValue(new Error("wallet connection lost"));
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow("without returning its hash");
    const saved = loadMachineDeployment()!;
    expect(saved).toMatchObject({ transport: "direct", steps: [{ status: "uncertain" }] });
    await expect(run()).rejects.toThrow("without returning its hash");
    expect(loadMachineDeployment()?.salt).toBe(saved.salt);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
  });

  it("waits for a direct revert to finalize before retrying the identical pinned deployment", async () => {
    let finalizedHeight = 19n;
    let retryMined = false;
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      rpc.getBlock.mockImplementation(async (...input: unknown[]) => {
        const query = input[0] as { blockTag?: string };
        return { hash: BLOCK_HASH, number: query.blockTag === "finalized" ? finalizedHeight : 20n, timestamp: BigInt(NOW) };
      });
      rpc.getTransactionReceipt.mockImplementation(async () => ({ ...deploymentReceipt(chainId), status: retryMined ? "success" : "reverted", logs: retryMined ? deploymentReceipt(chainId).logs : [] }));
      return rpc;
    });
    send.mockImplementation(async () => {
      if (send.mock.calls.length > 1) retryMined = true;
      return destinationHash(1);
    });
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow();
    const saved = snapshot(loadMachineDeployment()!);
    await expect(run()).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(latest.steps[0].hash).toBe(destinationHash(1));
    finalizedHeight = 20n;
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(latest).toMatchObject({ salt: saved.salt, calls: saved.calls, startsAtOrAfter: saved.startsAtOrAfter });
  });

  it("recovers a direct no-hash attempt from its supplied canonical execution without another send", async () => {
    send.mockRejectedValue(new Error("wallet response lost"));
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow("without returning its hash");
    expect(loadMachineDeployment()?.steps[0].hash).toBeUndefined();
    await expect(run({ executionHashes: { 1: destinationHash(1) } })).resolves.toMatchObject({ phase: "done" });
    expect(latest.steps[0]).toMatchObject({ status: "done", hash: destinationHash(1), projectId: "101" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("rejects bad or reverted supplied execution hashes without replacing the original proposal or resending", async () => {
    const reportedHash = `0x${"cf".repeat(32)}` as Hex;
    const revertedHash = `0x${"de".repeat(32)}` as Hex;
    send.mockResolvedValue(reportedHash);
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const getTransaction = rpc.getTransaction.getMockImplementation()!;
      rpc.waitForTransactionReceipt.mockRejectedValue(new Error("proposal has not executed"));
      rpc.getTransaction.mockImplementation(async args => ({ ...await getTransaction(args), ...(args.hash === destinationHash(1) ? { input: "0x1234" } : {}) }));
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }) => {
        if (hash === reportedHash) throw new Error("proposal has not executed");
        return { ...deploymentReceipt(chainId), transactionHash: hash, ...(hash === revertedHash ? { status: "reverted", logs: [] } : {}) };
      });
      return rpc;
    });
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow("proposal has not executed");
    for (const hash of [destinationHash(1), revertedHash]) {
      await expect(run({ executionHashes: { 1: hash } })).rejects.toThrow();
      expect(loadMachineDeployment()?.steps[0]).toMatchObject({ status: "uncertain", hash: reportedHash });
    }
    await expect(run()).rejects.toThrow("saved transaction is unresolved");
    expect(send).toHaveBeenCalledTimes(1);
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
  });

  it("recovers a standard Safe execution wrapper while preserving its originally reported proposal hash", async () => {
    const reportedHash = `0x${"cf".repeat(32)}` as Hex;
    const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)"]);
    smartAccount = true;
    send.mockResolvedValue(reportedHash);
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      rpc.waitForTransactionReceipt.mockRejectedValue(new Error("proposal has not executed"));
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }) => {
        if (hash === reportedHash) throw new Error("proposal has not executed");
        return deploymentReceipt(chainId);
      });
      rpc.getTransaction.mockImplementation(async ({ hash }) => {
        const call = latest.calls[0];
        return { hash, to: ACCOUNT, from: OTHER, value: 0n, chainId, blockHash: BLOCK_HASH, blockNumber: 20n,
          input: encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [call.to, BigInt(call.value), call.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x1234"] }) };
      });
      return rpc;
    });
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow("proposal has not executed");
    await expect(run({ executionHashes: { 1: destinationHash(1) } })).resolves.toMatchObject({ phase: "done", transport: "direct" });
    expect(latest.steps[0]).toMatchObject({ hash: destinationHash(1), reportedHash, projectId: "101" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled();
  });

  it("retries an unknown unpaid POST only after finalized expiration and unused original nonces", async () => {
    let finalizedTimestamp = NOW;
    let finalizedNonce = 0n;
    const later = NOW + 48 * 60 * 60;
    mocks.post.mockRejectedValueOnce(new Error("POST response lost"));
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const read = rpc.readContract.getMockImplementation()!;
      rpc.readContract.mockImplementation(async args => args.functionName === "nonces" && "blockNumber" in args ? finalizedNonce : read(args));
      rpc.getBlock.mockResolvedValue({ hash: BLOCK_HASH, number: 20n, timestamp: BigInt(finalizedTimestamp) });
      return rpc;
    });
    await expect(run()).rejects.toThrow("POST response lost");
    const original = snapshot(loadMachineDeployment()!);
    vi.setSystemTime(later * 1_000);
    await expect(run()).rejects.toThrow("original deployment is unresolved");
    finalizedTimestamp = later;
    finalizedNonce = 1n;
    await expect(run()).rejects.toThrow("original deployment is unresolved");
    expect(sign).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    finalizedNonce = 0n;
    offers = [payment(1, BUNDLE, later + 600)];
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(sign).toHaveBeenCalledTimes(4);
    expect(sign.mock.calls.slice(2).map(([args]) => args.message.nonce)).toEqual([0n, 0n]);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(latest).toMatchObject({ salt: original.salt, calls: original.calls, startsAtOrAfter: original.startsAtOrAfter });
    expect(latest.relayr?.history).toMatchObject([{ published: true, signed: original.relayr!.signed }]);
  });

  it("retries only the finalized failed Relayr destination after the original payment finalizes", async () => {
    const nextBundle = "87654321-1234-4321-8123-123456789abc";
    const nextPaymentHash = `0x${"ef".repeat(32)}` as Hex;
    const nextDestinationHash = `0x${"ed".repeat(32)}` as Hex;
    let paymentFinalizedHeight = 19n;
    let bundleCount = 0;
    const paidBundles = new Set<string>();
    const knownQuotes = new Map<string, RelayrQuote>();
    const paymentTransactions = new Map<Hex, { payment: RelayrPayment; chainId: number }>();
    const destinationTransactions = new Map<Hex, RelayrEntry>();
    mocks.post.mockImplementation(async (entries: RelayrEntry[], onPublished: (quote: RelayrUnboundQuote) => void) => {
      const bundle = bundleCount++ === 0 ? BUNDLE : nextBundle;
      const quotedPayments = [payment(1, bundle)];
      const quote = { ...bound(entries, quotedPayments), bundle_uuid: bundle };
      knownQuotes.set(bundle, snapshot(quote));
      for (const entry of entries) destinationTransactions.set(bundle === BUNDLE ? destinationHash(entry.chain) : nextDestinationHash, snapshot(entry));
      onPublished({ bundle_uuid: bundle, payment_info: quotedPayments, tx_uuids: quote.expectedTransactions.map(item => item.txUuid) });
      return quote;
    });
    mocks.status.mockImplementation(async (quote: RelayrQuote) => quote.expectedTransactions.map(binding => ({
      tx_uuid: binding.txUuid, request: binding.entry,
      status: paidBundles.has(quote.bundle_uuid) ? { state: "Confirmed", data: { hash: quote.bundle_uuid === BUNDLE ? destinationHash(binding.chain) : nextDestinationHash } } : { state: "Pending" },
    })));
    send.mockImplementation(async () => {
      const journal = loadMachineDeployment()!.relayr!;
      const hash = journal.quote!.bundle_uuid === BUNDLE ? PAYMENT_HASH : nextPaymentHash;
      paidBundles.add(journal.quote!.bundle_uuid);
      paymentTransactions.set(hash, { payment: snapshot(journal.payment!), chainId: connectedChain });
      return hash;
    });
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      rpc.getBlock.mockImplementation(async (...input: unknown[]) => {
        const query = input[0] as { blockTag?: string };
        return { hash: BLOCK_HASH, number: query.blockTag === "finalized" && chainId === 1 ? paymentFinalizedHeight : 20n, timestamp: BigInt(NOW) };
      });
      rpc.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
        const funding = paymentTransactions.get(hash);
        const entry = destinationTransactions.get(hash);
        if (!funding && !entry) throw new Error("Unknown fixture transaction");
        return { hash, to: funding?.payment.target ?? entry!.target, from: ACCOUNT,
          input: funding?.payment.calldata ?? entry!.data, value: BigInt(funding?.payment.amount ?? entry!.value),
          chainId: funding?.chainId ?? entry!.chain, blockHash: BLOCK_HASH, blockNumber: 20n };
      });
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (paymentTransactions.has(hash)) return { transactionHash: hash, blockHash: BLOCK_HASH, blockNumber: 20n, status: "success" };
        const receipt = deploymentReceipt(chainId);
        return { ...receipt, transactionHash: hash,
          ...(hash === destinationHash(10) ? { status: "reverted", logs: [] } : {}) };
      });
      return rpc;
    });

    await expect(run()).rejects.toThrow();
    const original = snapshot(loadMachineDeployment()!);
    expect(original.steps.map(step => step.status)).toEqual(["done", "failed"]);
    expect(original.relayr?.paymentHash).toBe(PAYMENT_HASH);
    expect(send).toHaveBeenCalledTimes(1);

    await expect(run()).rejects.toThrow();
    expect(sign).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    paymentFinalizedHeight = 20n;
    await expect(run()).resolves.toMatchObject({ phase: "done" });
    expect(sign).toHaveBeenCalledTimes(3);
    expect(sign.mock.calls[2][0].message.nonce).toBe(0n);
    expect(sign.mock.calls[2][0].domain.chainId).toBe(10n);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][0].map((entry: RelayrEntry) => entry.chain)).toEqual([10]);
    expect(chooseFunding).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ salt: original.salt, calls: original.calls, startsAtOrAfter: original.startsAtOrAfter });
    expect(latest.steps[0]).toEqual(original.steps[0]);
    expect(latest.relayr?.history).toMatchObject([{ paymentHash: PAYMENT_HASH, quote: knownQuotes.get(BUNDLE), signed: original.relayr!.signed }]);
    expect(latest.relayr?.quote?.bundle_uuid).toBe(nextBundle);
  });

  it("keeps deployed smart-account wallets on the direct path", async () => {
    smartAccount = true;
    await expect(run()).resolves.toMatchObject({ phase: "done", transport: "direct" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sign).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled(); expect(chooseFunding).not.toHaveBeenCalled();
  });

  it("requires the canonical Create event plus the exact deployed configuration and caller", async () => {
    chooseFunding.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("canceled");
    const call = latest.calls[0];
    expect(machineProjectIdFromReceipt(deploymentReceipt(1), call, ACCOUNT)).toBe("101");
    for (const changes of [{ caller: OTHER }, { name: "Different machine" }, { createAddress: OTHER }, { projectId: 0n }]) {
      expect(() => machineProjectIdFromReceipt(deploymentReceipt(1, changes), call, ACCOUNT)).toThrow();
    }
    const receipt = deploymentReceipt(1);
    expect(() => machineProjectIdFromReceipt({ ...receipt, logs: receipt.logs.slice(1) }, call, ACCOUNT)).toThrow();
  });
});
