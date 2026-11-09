import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JBCoreContracts, getJBContractAddress, jbProjectsAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAbiItem, parseAbi, zeroAddress, zeroHash, type AbiEvent, type Address, type Hex, type TransactionReceipt } from "viem";
import type { Config } from "@wagmi/core";
import { buildDeployArgs, projectsFor } from "@/lib/plugin/deploy";
import { RELAYR_API, RELAYR_NATIVE_TOKEN, RELAYR_PAYMENT_ADDRESS, RELAYR_PAYMENT_SELECTOR, type RelayrEntry, type RelayrPayment } from "@bananapus/nana-sdk-core/review/relayr";
import { canClearMachineDeployment, clearMachineDeployment, loadMachineDeployment, machineDeploymentDone, type MachineDeploySession } from "@/lib/plugin/deploy-session";
import { machineProjectIdFromReceipt, runMachineDeployment, type MachineDeployReview } from "@/lib/plugin/relayr-deploy";
import type { MachineDraft } from "@/lib/plugin/types";
import { savedAttempts } from "@/lib/plugin/write-holds";
import type { SavedAttempt, WriteHoldClient } from "@bananapus/nana-sdk-core/review";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(), getPublicClient: vi.fn(), getWalletClient: vi.fn(), switchChain: vi.fn(), runtime: vi.fn(),
}));
vi.mock("@wagmi/core", () => ({ getAccount: mocks.getAccount, getPublicClient: mocks.getPublicClient, getWalletClient: mocks.getWalletClient, switchChain: mocks.switchChain }));
// The pinned payment runtime's preimage is not reproducible here; its check is the SDK's and is stubbed.
vi.mock("@bananapus/nana-sdk-core/review/relayr", async importOriginal => ({
  ...await importOriginal<typeof import("@bananapus/nana-sdk-core/review/relayr")>(),
  requireRelayrPaymentRuntime: mocks.runtime,
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const BUNDLE = "12345678-1234-4321-8123-123456789abc";
const NOW = 1_800_000_000;
const PAYMENT_HASH = `0x${"ab".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"bc".repeat(32)}` as Hex;
const destinationHash = (chain: number) => `0x${chain.toString(16).padStart(64, "0")}` as Hex;
const txUuid = (chain: number, bundle = BUNDLE) => `${chain.toString(16).padStart(8, "0")}-${bundle.slice(9)}`;
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
/** A fake Relayr: every posted bundle, the next bundle IDs to hand out, and its answers. */
let posts: RelayrEntry[][];
let bundleIds: string[];
let postResponse: ((entries: RelayrEntry[]) => Response) | null;
let recordState: (uuid: string, chain: number) => { state: string; data?: { hash: Hex } };
const posted = new Map<string, RelayrEntry[]>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const recordsOf = (uuid: string) => posted.get(uuid)!.map(entry => ({ tx_uuid: txUuid(entry.chain, uuid), request: entry, status: recordState(uuid, entry.chain) }));
const relayrFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === `${RELAYR_API}/v1/bundle/prepaid` && init?.method === "POST") {
    const entries = (JSON.parse(String(init.body)) as { transactions: RelayrEntry[] }).transactions;
    posts.push(entries);
    events.push("quote");
    if (postResponse) return postResponse(entries);
    const uuid = bundleIds.shift() ?? BUNDLE;
    posted.set(uuid, entries);
    return json({ bundle_uuid: uuid, payment_info: snapshot(offers).map(offer => ({ ...offer, calldata: offer.calldata.replace(BUNDLE.replaceAll("-", ""), uuid.replaceAll("-", "")) })),
      tx_uuids: entries.map(entry => txUuid(entry.chain, uuid)), transactions: recordsOf(uuid) });
  }
  const uuid = url.match(/\/v1\/bundle\/([0-9a-f-]{36})$/u)?.[1];
  if (uuid && posted.has(uuid)) return json({ bundle_uuid: uuid, payment_received: mined, transactions: recordsOf(uuid) });
  return json({}, 404);
});
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
  const to = latest.relayr?.signed.find(item => item.chainId === chainId)?.entry.target ?? call.to;
  return { transactionHash: destinationHash(chainId), to, blockHash: BLOCK_HASH, blockNumber: 20n, status: "success", logs } as TransactionReceipt;
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
        const selected = latest.relayr!.quote!.payment_info.find(item => item.chain === latest.relayr!.paymentChainId)!;
        return { hash, to: selected.target, from: ACCOUNT, input: selected.calldata, value: BigInt(selected.amount), chainId, blockHash: BLOCK_HASH, blockNumber: 20n };
      }
      const call = latest.calls.find(call => call.chainId === chainId)!;
      const entry = latest.relayr?.signed.find(item => item.chainId === chainId)?.entry;
      return { hash, to: entry?.target ?? call.to, from: ACCOUNT, input: entry?.data ?? call.data, value: BigInt(entry?.value ?? call.value), chainId, blockHash: BLOCK_HASH, blockNumber: 20n };
    }),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => hash === PAYMENT_HASH
      ? { transactionHash: hash, to: RELAYR_PAYMENT_ADDRESS, blockHash: BLOCK_HASH, blockNumber: 20n, status: "success", logs: [] }
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
  storage.clear(); events.length = 0; posted.clear();
  posts = []; bundleIds = []; postResponse = null;
  recordState = (_uuid, chain) => mined ? { state: "Success", data: { hash: destinationHash(chain) } } : { state: "Pending" };
  vi.stubGlobal("fetch", relayrFetch);
  mocks.runtime.mockResolvedValue(undefined);
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
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("machine Relayr deployment", () => {
  it("signs every destination before offering validated returned quotes and makes one payment", async () => {
    offers = [payment(10), payment(8453), payment(11155111), { ...payment(1), target: OTHER }];
    chooseFunding.mockImplementation(async options => { events.push("choose"); expect(options.map(option => option.chainId)).toEqual([10, 8453]); expect(options[0].label).toContain("0.001 ETH"); return 8453; });
    const completed = await run();
    expect(events).toEqual(["review:authorization", "sign", "review:authorization", "sign", "quote", "choose", "review:payment", "pay"]);
    expect(machineDeploymentDone(completed)).toBe(true);
    expect(completed).toMatchObject({ transport: "relayr", relayr: { phase: "executing", paymentChainId: 8453, payments: [{ hash: PAYMENT_HASH, chainId: 8453 }] } });
    expect(completed.steps.map(step => step.projectId)).toEqual(["101", "110"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ chain: { id: 8453 }, to: RELAYR_PAYMENT_ADDRESS, value: 1_000_000_000_000_000n });
  });

  it("signs authorizations that expire two hours out so a canceled payment can be abandoned the same day", async () => {
    chooseFunding.mockResolvedValueOnce(null);
    await expect(run()).rejects.toThrow("payment canceled");
    expect(sign.mock.calls.map(([args]) => args.message.deadline)).toEqual([NOW + 2 * 60 * 60, NOW + 2 * 60 * 60]);
    expect(loadMachineDeployment()!.relayr!.signed.map(item => item.deadline)).toEqual([NOW + 2 * 60 * 60, NOW + 2 * 60 * 60]);
  });

  it("persists all exact signed requests before publishing the bundle", async () => {
    postResponse = entries => {
      const persisted = loadMachineDeployment()!;
      expect(persisted.relayr).toMatchObject({ phase: "quoting", published: true, signed: entries.map(entry => ({ chainId: entry.chain })) });
      expect(persisted.relayr!.signed.map(item => item.entry.data)).toEqual(entries.map(entry => entry.data));
      throw new TypeError("response lost");
    };
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
    await expect(run({ draft: { ...originalDraft, chainIds: [11155111, 11155420, 84532, 421614] } })).resolves.toSatisfy(machineDeploymentDone);
    expect(sign).toHaveBeenCalledTimes(4);
    expect(posts).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the POST response is lost", () => { throw new TypeError("response lost"); }],
    ["Relayr's answer cannot be bound", () => json({ bundle_uuid: BUNDLE, payment_info: [], tx_uuids: [] })],
  ] as const)("quotes the same signatures again while they are live when %s", async (_case, answer) => {
    postResponse = answer;
    await expect(run()).rejects.toThrow();
    expect(loadMachineDeployment()!.relayr).toMatchObject({ phase: "quoting", published: true });
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
    postResponse = null;
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
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
    expect(posts).toHaveLength(1);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resumes a saved v1 deployment from its payment flags, whatever its saved phase says", async () => {
    chooseFunding.mockResolvedValueOnce(null);
    await expect(run()).rejects.toThrow("payment canceled");
    const saved = JSON.parse(storage.get("plugin-machine-deployment-v1")!);
    const quote = { ...saved.relayr.quote, transactions: undefined };
    storage.set("plugin-machine-deployment-v1", JSON.stringify({ ...saved, phase: "quoted", relayr: {
      signed: saved.relayr.signed, published: true, quote, records: [], payment: quote.payment_info[0], paymentStarted: true, paymentHash: PAYMENT_HASH,
    } }));
    expect(loadMachineDeployment()!.relayr).toMatchObject({ phase: "submitted", paymentChainId: 1, paymentHash: PAYMENT_HASH });
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
    mined = true;
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(send).not.toHaveBeenCalled();
    expect(chooseFunding).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });

  it("keeps watching a slow but healthy bundle past a minute without a manual resume", async () => {
    let reads = 0;
    recordState = (_uuid, chain) => mined && ++reads > 60 ? { state: "Success", data: { hash: destinationHash(chain) } } : { state: "Pending" };
    const deployed = run();
    deployed.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(deployed).resolves.toSatisfy(machineDeploymentDone);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps unpaid destinations pending when resuming a canceled funding choice", async () => {
    chooseFunding.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      expect(latest.steps.map(step => step.status)).toEqual(["pending", "pending"]);
      return null;
    });
    await expect(run()).rejects.toThrow("payment canceled");
    await expect(run()).rejects.toThrow("payment canceled");
    expect(chooseFunding).toHaveBeenCalledTimes(2);
    expect(loadMachineDeployment()!.steps.map(step => step.status)).toEqual(["pending", "pending"]);
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
      expect(loadMachineDeployment()?.relayr).toMatchObject({ phase: "payment-signing", paymentChainId: 1 });
      throw new Error("wallet disconnected after send");
    });
    await expect(run()).rejects.toThrow("without returning its hash");
    await expect(run()).rejects.toMatchObject({ name: "SavedAttemptShownError", message: expect.stringContaining("without returning its hash") });
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(chooseFunding).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });

  it.each<[string, () => void, Parameters<typeof run>[0]]>([
    ["signature", () => sign.mockRejectedValueOnce(new Error("User denied", { cause: { name: "UserRejectedRequestError", code: 4001 } })), {}],
    ["direct transaction", () => send.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 })), { draft: { ...originalDraft, chainIds: [1] } }],
  ])("shows one readable line when the %s is rejected in the wallet", async (_kind, reject, overrides) => {
    reject();
    await expect(run(overrides)).rejects.toThrow(/^You canceled in your wallet\.$/);
    expect(loadMachineDeployment()!.steps.every(step => step.status === "pending")).toBe(true);
  });

  it("keeps the wallet's own error when a rejection carries no 4001 code", async () => {
    sign.mockRejectedValueOnce(new Error("User denied", { cause: { name: "UserRejectedRequestError" } }));
    await expect(run()).rejects.toThrow(/^User denied$/);
  });

  it("allows review of the same quote after an explicit wallet rejection", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("User rejected the request.\n\nVersion: viem@2"), { code: 4001 }));
    await expect(run()).rejects.toThrow(/^You canceled in your wallet\.$/);
    expect(loadMachineDeployment()?.relayr).toMatchObject({ phase: "quoted" });
    expect(loadMachineDeployment()?.relayr?.paymentChainId).toBeUndefined();
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(posts).toHaveLength(1);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("pays a quote again after a sped-up payment's replacement reverts, remembering only the mined replacement", async () => {
    const dropped = `0x${"a1".repeat(32)}` as Hex;
    const replacement = `0x${"a2".repeat(32)}` as Hex;
    send.mockImplementation(async () => {
      if (send.mock.calls.length === 1) return dropped;
      mined = true;
      return PAYMENT_HASH;
    });
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const transaction = rpc.getTransaction.getMockImplementation()!;
      const receipt = rpc.getTransactionReceipt.getMockImplementation()!;
      rpc.waitForTransactionReceipt.mockImplementation((async ({ hash }: { hash: Hex }) => (hash === dropped
        ? { transactionHash: replacement, status: "reverted" } : { transactionHash: hash, status: "success" })) as never);
      rpc.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (hash === dropped) throw new Error("transaction not found");
        return { ...await transaction({ hash: hash === replacement ? PAYMENT_HASH : hash }), hash };
      });
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (hash === dropped) throw new Error("receipt not found");
        const found = await receipt({ hash: hash === replacement ? PAYMENT_HASH : hash });
        return hash === replacement ? { ...found, transactionHash: hash, status: "reverted" } : found;
      });
      return rpc;
    });
    await expect(run()).rejects.toThrow();
    expect(loadMachineDeployment()!.relayr).toMatchObject({ phase: "payment-reverted", payments: [{ hash: replacement }] });
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(send).toHaveBeenCalledTimes(2);
    expect(posts).toHaveLength(1);
  });

  it.each([
    ["while its destination requests are live", false],
    ["once every request expired but the payment chain can't prove its deadline", true],
  ])("lets the user check a payment sent without a hash and resolve the deployment %s", async (_case, expired) => {
    const requestsDead = NOW + 2.5 * 60 * 60;
    offers = [payment(1), payment(8453)];
    chooseFunding.mockResolvedValue(8453);
    send.mockRejectedValueOnce(new Error("wallet disconnected after send"));
    await expect(run()).rejects.toThrow("without returning its hash");
    if (expired) {
      vi.setSystemTime(requestsDead * 1_000);
      mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
        const rpc = client(chainId);
        if (chainId === 8453) rpc.getBlock.mockRejectedValue(new Error("finalized block unavailable"));
        else rpc.getBlock.mockResolvedValue({ hash: BLOCK_HASH, number: 20n, timestamp: BigInt(requestsDead) });
        return rpc;
      });
    }
    const shown = await run().then(() => null, (error: unknown) => error as Error & { attempt?: SavedAttempt<unknown> });
    expect(shown?.name).toBe("SavedAttemptShownError");
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(false);
    const attempt = shown!.attempt!;
    const outcome = await savedAttempts.recover(attempt, client(attempt.chainId) as unknown as WriteHoldClient);
    expect(outcome.status).toBe("check");
    if (outcome.status !== "check") return;
    await expect(savedAttempts.retire(attempt, { by: "check", outcome })).resolves.toMatchObject({ retired: true });
    await expect(run()).rejects.toThrow("may already have run");
    expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });

  it("checks a no-hash payment's original destination transactions without paying again", async () => {
    send.mockImplementation(async () => { mined = true; throw new Error("wallet response lost"); });
    await expect(run()).rejects.toThrow("without returning its hash");
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(send).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
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
    mocks.runtime.mockRejectedValueOnce(new Error("The Relayr payment contract does not match its verified runtime."));
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
    expect(posts).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["unreadable", "blocked", "silent write loss"])("blocks wallet actions when recovery storage is %s", async failure => {
    if (failure === "unreadable") storage.set("plugin-machine-deployment-v1", "{");
    if (failure === "blocked") localStorageMock.getItem.mockImplementation(() => { throw new Error("blocked"); });
    if (failure === "silent write loss") localStorageMock.setItem.mockImplementation(() => {});
    await expect(run()).rejects.toThrow(/saved deployment|browser storage|recovery/u);
    expect(sign).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(posts).toHaveLength(0);
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
    expect(posts).toHaveLength(1);
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
    expect(sign).not.toHaveBeenCalled(); expect(posts).toHaveLength(0);
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
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(latest).toMatchObject({ salt: saved.salt, calls: saved.calls, startsAtOrAfter: saved.startsAtOrAfter });
  });

  it("recovers a direct no-hash attempt from its supplied canonical execution without another send", async () => {
    send.mockRejectedValue(new Error("wallet response lost"));
    await expect(run({ draft: { ...originalDraft, chainIds: [1] } })).rejects.toThrow("without returning its hash");
    expect(loadMachineDeployment()?.steps[0].hash).toBeUndefined();
    await expect(run({ executionHashes: { 1: destinationHash(1) } })).resolves.toSatisfy(machineDeploymentDone);
    expect(latest.steps[0]).toMatchObject({ status: "done", hash: destinationHash(1), projectId: "101" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(0);
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
    await expect(run({ executionHashes: { 1: destinationHash(1) } })).resolves.toSatisfy(machineDeploymentDone);
    expect(latest.transport).toBe("direct");
    expect(latest.steps[0]).toMatchObject({ hash: destinationHash(1), reportedHash, projectId: "101" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled();
  });

  describe("once the published requests are dead at a finalized block", () => {
    const later = NOW + 48 * 60 * 60;
    let finalizedNonce: bigint;
    beforeEach(() => {
      finalizedNonce = 0n;
      postResponse = () => { throw new TypeError("response lost"); };
      mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
        const rpc = client(chainId);
        const read = rpc.readContract.getMockImplementation()!;
        rpc.readContract.mockImplementation(async args => args.functionName === "nonces" && "blockNumber" in args ? finalizedNonce : read(args));
        rpc.getBlock.mockResolvedValue({ hash: BLOCK_HASH, number: 20n, timestamp: BigInt(Math.floor(Date.now() / 1_000)) });
        return rpc;
      });
    });

    it("abandons without signing again when a nonce moved", async () => {
      await expect(run()).rejects.toThrow("response lost");
      vi.setSystemTime(later * 1_000);
      finalizedNonce = 1n;
      await expect(run()).rejects.toThrow("may already have run");
      expect(loadMachineDeployment()!.steps.every(step => step.status === "failed")).toBe(true);
      expect(canClearMachineDeployment(loadMachineDeployment()!)).toBe(true);
      expect(sign).toHaveBeenCalledTimes(2);
      expect(posts).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
    });

    it("signs again at the saved nonces when every request expired unused", async () => {
      await expect(run()).rejects.toThrow("response lost");
      const original = snapshot(loadMachineDeployment()!);
      vi.setSystemTime(later * 1_000);
      await expect(run()).rejects.toThrow("expired");
      expect(posts).toHaveLength(1);
      postResponse = null;
      offers = [payment(1, BUNDLE, later + 600)];
      await expect(run()).resolves.toSatisfy(machineDeploymentDone);
      expect(sign).toHaveBeenCalledTimes(4);
      expect(sign.mock.calls.slice(2).map(([args]) => args.message.nonce)).toEqual([0n, 0n]);
      expect(posts).toHaveLength(2);
      expect(send).toHaveBeenCalledTimes(1);
      expect(latest).toMatchObject({ salt: original.salt, calls: original.calls, startsAtOrAfter: original.startsAtOrAfter });
      expect(latest.relayr?.superseded).toEqual(original.relayr!.signed);
    });
  });

  it("signs only the destination that reverted onchain again at its saved nonce", async () => {
    const nextBundle = "87654321-1234-4321-8123-123456789abc";
    const nextPaymentHash = `0x${"ef".repeat(32)}` as Hex;
    const nextDestinationHash = `0x${"ed".repeat(32)}` as Hex;
    bundleIds = [BUNDLE, nextBundle];
    recordState = (uuid, chain) => !mined ? { state: "Pending" } : { state: "Success", data: { hash: uuid === BUNDLE ? destinationHash(chain) : nextDestinationHash } };
    send.mockImplementation(async () => { mined = true; return send.mock.calls.length === 1 ? PAYMENT_HASH : nextPaymentHash; });
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const transaction = rpc.getTransaction.getMockImplementation()!;
      const receipt = rpc.getTransactionReceipt.getMockImplementation()!;
      rpc.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => ({ ...await transaction({ hash: hash === nextPaymentHash ? PAYMENT_HASH : hash }), hash }));
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        const found = await receipt({ hash: hash === nextPaymentHash ? PAYMENT_HASH : hash });
        return { ...found, transactionHash: hash, ...(hash === destinationHash(10) ? { status: "reverted", logs: [] } : {}) };
      });
      return rpc;
    });

    await expect(run()).rejects.toThrow("did not deploy");
    const original = snapshot(loadMachineDeployment()!);
    expect(original.steps.map(step => step.status)).toEqual(["done", "pending"]);
    expect(send).toHaveBeenCalledTimes(1);

    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(sign).toHaveBeenCalledTimes(3);
    expect(sign.mock.calls[2][0].message.nonce).toBe(0n);
    expect(sign.mock.calls[2][0].domain.chainId).toBe(10n);
    expect(posts.map(entries => entries.map(entry => entry.chain))).toEqual([[1, 10], [10]]);
    expect(chooseFunding).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ salt: original.salt, calls: original.calls, startsAtOrAfter: original.startsAtOrAfter });
    expect(latest.steps[0]).toEqual(original.steps[0]);
    expect(latest.relayr?.superseded?.map(item => item.chainId)).toEqual([10]);
    expect(latest.relayr?.quote?.bundle_uuid).toBe(nextBundle);
  });

  it("retries a reverted destination only once the kept success, the revert and the payment are finalized", async () => {
    const nextBundle = "87654321-1234-4321-8123-123456789abc";
    const nextPaymentHash = `0x${"ef".repeat(32)}` as Hex;
    const nextDestinationHash = `0x${"ed".repeat(32)}` as Hex;
    let finalizedHeight = 19n;
    let vanished = false;
    bundleIds = [BUNDLE, nextBundle];
    recordState = (uuid, chain) => !mined ? { state: "Pending" } : { state: "Success", data: { hash: uuid === BUNDLE ? destinationHash(chain) : nextDestinationHash } };
    send.mockImplementation(async () => { mined = true; return send.mock.calls.length === 1 ? PAYMENT_HASH : nextPaymentHash; });
    mocks.getPublicClient.mockImplementation((_config, { chainId }: { chainId: number }) => {
      const rpc = client(chainId);
      const transaction = rpc.getTransaction.getMockImplementation()!;
      const receipt = rpc.getTransactionReceipt.getMockImplementation()!;
      rpc.getBlock.mockImplementation(async (...input: unknown[]) => ({ hash: BLOCK_HASH, timestamp: BigInt(NOW),
        number: (input[0] as { blockTag?: string }).blockTag === "finalized" ? finalizedHeight : 20n }));
      rpc.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => ({ ...await transaction({ hash: hash === nextPaymentHash ? PAYMENT_HASH : hash }), hash }));
      rpc.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (vanished && chainId === 1 && hash === destinationHash(1)) throw new Error("receipt not found");
        const found = await receipt({ hash: hash === nextPaymentHash ? PAYMENT_HASH : hash });
        return { ...found, transactionHash: hash, ...(hash === destinationHash(10) ? { status: "reverted", logs: [] } : {}) };
      });
      return rpc;
    });

    await expect(run()).rejects.toThrow("not finalized");
    expect(loadMachineDeployment()!.steps.map(step => step.status)).toEqual(["done", "failed"]);
    expect(loadMachineDeployment()!.relayr?.superseded).toBeUndefined();
    // The kept success's block reorgs away: retrying the other chain must not report the machine deployed.
    vanished = true;
    await expect(run()).rejects.toThrow("receipt not found");
    expect(machineDeploymentDone(latest)).toBe(false);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);

    vanished = false;
    finalizedHeight = 20n;
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(sign).toHaveBeenCalledTimes(3);
    expect(posts.map(entries => entries.map(entry => entry.chain))).toEqual([[1, 10], [10]]);
  });

  it("deploys and clears without Web Locks, on the SDK's fallback lock", async () => {
    vi.stubGlobal("navigator", {});
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    await expect(clearMachineDeployment()).resolves.toBeUndefined();
    expect(loadMachineDeployment()).toBeNull();
  });

  it("keeps deployed smart-account wallets on the direct path", async () => {
    smartAccount = true;
    await expect(run()).resolves.toSatisfy(machineDeploymentDone);
    expect(latest.transport).toBe("direct");
    expect(send).toHaveBeenCalledTimes(2);
    expect(sign).not.toHaveBeenCalled(); expect(posts).toHaveLength(0); expect(chooseFunding).not.toHaveBeenCalled();
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
