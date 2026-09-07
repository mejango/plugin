import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  bindRelayrQuote, fetchRelayrStatus, isRelayrChainSet, paymentDetails, paymentLabel,
  postRelayrBundle, relayrDestinationHash, relayrPaymentChains, relayrPaymentOptions,
  RELAYR_NATIVE_TOKEN, RELAYR_PAYMENT_ADDRESS, RELAYR_PAYMENT_SELECTOR,
  type RelayrEntry, type RelayrPayment, type RelayrQuote, type RelayrTransactionRecord,
  type RelayrUnboundQuote,
} from "@/lib/plugin/relayr-protocol";

const BUNDLE = "12345678-1234-4321-8123-123456789abc";
const TX_A = "aaaaaaaa-1234-4321-8123-123456789abc";
const TX_B = "bbbbbbbb-1234-4321-8123-123456789abc";
const TARGET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const HASH_A = `0x${"ab".repeat(32)}` as Hex;
const HASH_B = `0x${"cd".repeat(32)}` as Hex;
const NOW = 1_800_000_000;
const DEADLINE = NOW + 600;
const calldata = (deadline = DEADLINE) => `${RELAYR_PAYMENT_SELECTOR}${BUNDLE.replaceAll("-", "")}${"0".repeat(32)}${BigInt(deadline).toString(16).padStart(64, "0")}` as Hex;
const payment = (overrides: Partial<RelayrPayment> = {}): RelayrPayment => ({
  chain: 1, target: RELAYR_PAYMENT_ADDRESS, token: RELAYR_NATIVE_TOKEN,
  amount: "1000000000000000", calldata: calldata(), payment_deadline: new Date(DEADLINE * 1_000).toISOString(),
  ...overrides,
});
const entry = (overrides: Partial<RelayrEntry> = {}): RelayrEntry => ({ chain: 1, target: TARGET, data: "0x1234", value: "0", ...overrides });
const entries = () => [entry(), entry({ chain: 10, data: "0x5678" })];
const record = (request = entry({ virtual_nonce: 0 }), txUuid = TX_A): RelayrTransactionRecord => ({ request, tx_uuid: txUuid, status: { state: "Pending" } });
const records = () => [record(entry({ virtual_nonce: 0 })), record(entry({ chain: 10, data: "0x5678", virtual_nonce: 0 }), TX_B)];
const unbound = (): RelayrUnboundQuote => ({ bundle_uuid: BUNDLE, payment_info: [payment()], tx_uuids: [TX_A, TX_B] });
const quote = (payments = [payment()]): RelayrQuote => ({
  bundle_uuid: BUNDLE, payment_info: payments,
  expectedTransactions: records().map(row => ({ txUuid: row.tx_uuid, chain: row.request.chain, entry: row.request })),
});
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1_000);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Relayr deployment quote binding", () => {
  it("binds exact requests even when both provider arrays are reordered", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...unbound(), tx_uuids: [TX_B, TX_A] }));
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions: records().reverse() }));
    const result = await postRelayrBundle(entries());
    expect(result.expectedTransactions.map(binding => binding.txUuid)).toEqual([TX_A, TX_B]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ transactions: entries().map(row => ({ ...row, virtual_nonce: 0 })), virtual_nonce_mode: "ChainIndependent" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.relayr.ba5ed.com/v1/bundle/prepaid");
    expect(fetchMock.mock.calls[1][0]).toBe(`https://api.relayr.ba5ed.com/v1/bundle/${BUNDLE}`);
    expect(Object.isFrozen(result.expectedTransactions[0].entry)).toBe(true);
  });

  it("persists the known quote before a failed binding GET and resumes without posting again", async () => {
    fetchMock.mockResolvedValueOnce(response(unbound()));
    fetchMock.mockRejectedValueOnce(new Error("status unavailable"));
    let saved: RelayrUnboundQuote | undefined;
    await expect(postRelayrBundle(entries(), published => { saved = published; })).rejects.toThrow("status unavailable");
    expect(saved?.bundle_uuid).toBe(BUNDLE);
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions: records() }));
    await expect(bindRelayrQuote(saved!, entries())).resolves.toMatchObject({ bundle_uuid: BUNDLE });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("snapshots client entries before any async response and does not trust provider bindings", async () => {
    const original = entries();
    fetchMock.mockImplementationOnce(async () => {
      original[0].target = OTHER;
      return response({ ...unbound(), expectedTransactions: [{ txUuid: TX_B, chain: 1, entry: original[0] }] });
    });
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions: records() }));
    const result = await postRelayrBundle(original);
    expect(result.expectedTransactions[0]).toMatchObject({ txUuid: TX_A, entry: { target: TARGET } });
  });

  it("assigns sequential virtual nonces independently per chain", async () => {
    const requests = [entry(), entry({ data: "0xabcd" })];
    fetchMock.mockResolvedValueOnce(response(unbound()));
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions: [record({ ...requests[1], virtual_nonce: 1 }, TX_B), record({ ...requests[0], virtual_nonce: 0 })] }));
    const result = await postRelayrBundle(requests);
    expect(result.expectedTransactions.map(binding => binding.entry.virtual_nonce)).toEqual([0, 1]);
  });

  it.each([
    ["missing request", [{ tx_uuid: TX_A }, records()[1]]],
    ["missing nonce", [record(entry()), records()[1]]],
    ["duplicate request", [records()[0], record(records()[0].request, TX_B)]],
    ["duplicate UUID", [records()[0], record(records()[1].request, TX_A)]],
    ["unexpected UUID", [records()[0], record(records()[1].request, BUNDLE)]],
    ["missing transaction", [records()[0]]],
  ])("rejects %s instead of using array position", async (_label, transactions) => {
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions }));
    await expect(bindRelayrQuote(unbound(), entries())).rejects.toThrow();
  });

  it.each([
    { tx_uuids: [TX_A, TX_A] },
    { tx_uuids: [TX_A] },
    { tx_uuids: [TX_A, 9] },
    { tx_uuids: [TX_A, TX_B], txn_uuids: [TX_B, TX_A] },
    { bundle_uuid: "not-a-uuid" },
  ])("rejects malformed quote identifiers before exposing a payment", async change => {
    fetchMock.mockResolvedValueOnce(response({ ...unbound(), ...change }));
    const onPublished = vi.fn();
    await expect(postRelayrBundle(entries(), onPublished)).rejects.toThrow();
    expect(onPublished).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[], [entry({ chain: 137 })], [entry(), entry({ chain: 11155111 })]].map(requests => ({ requests })))("rejects unsupported or mixed destinations before publication", async ({ requests }) => {
    await expect(postRelayrBundle(requests)).rejects.toThrow("network family");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry failed publication automatically", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(postRelayrBundle(entries())).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds publication waits and preserves uncertainty on timeout", async () => {
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const pending = expect(postRelayrBundle(entries())).rejects.toThrow("published requests must not be submitted again");
    await vi.advanceTimersByTimeAsync(45_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("authenticated Relayr status", () => {
  it.each([[], [records()[1]], records().reverse()].map(transactions => ({ transactions })))("accepts pending subsets and reordered members", async ({ transactions }) => {
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions }));
    await expect(fetchRelayrStatus(quote())).resolves.toHaveLength(transactions.length);
  });

  it.each([
    { chain: 10 }, { target: OTHER }, { data: "0x5678" as Hex }, { value: "1" }, { virtual_nonce: 1 },
  ])("rejects a changed destination request: %j", async change => {
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE, transactions: [record(entry({ virtual_nonce: 0, ...change }))] }));
    await expect(fetchRelayrStatus(quote())).rejects.toThrow("authenticated deployment");
  });

  it("accepts equivalent hexadecimal values and address case", async () => {
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: BUNDLE.toUpperCase(), transactions: [record(entry({ value: "0x00", virtual_nonce: 0 }), TX_A.toUpperCase())] }));
    await expect(fetchRelayrStatus(quote())).resolves.toHaveLength(1);
  });

  it("rejects another bundle and conflicting saved bindings", async () => {
    fetchMock.mockResolvedValueOnce(response({ bundle_uuid: TX_A, transactions: records() }));
    await expect(fetchRelayrStatus(quote())).rejects.toThrow("this bundle");
    const saved = quote();
    saved.expectedTransactions[1].txUuid = TX_A;
    await expect(fetchRelayrStatus(saved)).rejects.toThrow("conflicting destination");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Relayr quote payment authentication", () => {
  it("parses an immutable exact native payment tuple and an exact amount label", () => {
    const result = paymentDetails(payment(), BUNDLE);
    expect(result).toEqual({ chainId: 1, target: RELAYR_PAYMENT_ADDRESS, amount: 1_000_000_000_000_000n, calldata: calldata(), bundleUuid: BUNDLE, deadline: BigInt(DEADLINE) });
    expect(Object.isFrozen(result)).toBe(true);
    expect(paymentLabel(payment())).toBe("Ethereum — 0.001 ETH");
  });

  it.each([1, 10, 8453, 42161, 11155111, 11155420, 84532, 421614])("supports the canonical payment on chain %s", chain => {
    expect(paymentDetails(payment({ chain }), BUNDLE).chainId).toBe(chain);
  });

  it("allows receipt recovery to inspect an expired tuple while retaining every authenticity check", () => {
    const expired = payment({ calldata: calldata(NOW - 1), payment_deadline: NOW - 1 });
    expect(() => paymentDetails(expired, BUNDLE)).toThrow("expired");
    expect(paymentDetails(expired, BUNDLE, { allowExpired: true }).deadline).toBe(BigInt(NOW - 1));
    for (const change of [
      { target: OTHER }, { token: OTHER }, { chain: 137 }, { amount: "-1" },
      { payment_deadline: NOW - 2 }, { calldata: calldata() },
      { calldata: `${expired.calldata}00` as Hex },
    ]) expect(() => paymentDetails({ ...expired, ...change }, BUNDLE, { allowExpired: true })).toThrow();
    expect(() => paymentDetails(expired, TX_A, { allowExpired: true })).toThrow("this bundle");
    expect(relayrPaymentOptions(quote([expired]), [1])).toEqual([]);
  });

  it.each([
    { chain: 137 }, { target: OTHER }, { token: OTHER }, { token: undefined },
    { amount: "-1" }, { amount: " 1" }, { amount: "1.1" }, { amount: (2n ** 256n).toString() },
    { calldata: `${calldata()}00` as Hex }, { calldata: `0x00000000${calldata().slice(10)}` as Hex },
    { calldata: calldata().replace(BUNDLE.replaceAll("-", ""), TX_A.replaceAll("-", "")) as Hex },
    { calldata: calldata(DEADLINE + 1) }, { payment_deadline: undefined },
    { payment_deadline: "tomorrow" }, { payment_deadline: DEADLINE + 1 },
    { calldata: calldata(NOW + 15), payment_deadline: NOW + 15 },
  ])("rejects unauthenticated payment field: %j", change => {
    expect(() => paymentDetails(payment(change), BUNDLE)).toThrow();
  });

  it("exposes only returned valid offers in the same network family", () => {
    const offers = [payment(), payment({ chain: 10 }), payment({ chain: 11155111 }), payment({ chain: 8453, target: OTHER })];
    expect(relayrPaymentOptions(quote(offers), [1, 42161]).map(row => row.chain)).toEqual([1, 10]);
    expect(relayrPaymentOptions(quote(offers), [11155111, 84532]).map(row => row.chain)).toEqual([11155111]);
    expect(relayrPaymentOptions(quote(offers), [1, 11155111])).toEqual([]);
  });

  it("deduplicates equivalent offers and excludes every conflicting offer for a chain", () => {
    const same = payment({ amount: "0x38d7ea4c68000" });
    expect(relayrPaymentOptions(quote([payment(), same]), [1])).toHaveLength(1);
    const offers = [payment(), payment({ chain: 10 }), payment({ amount: "2" }), payment()];
    expect(relayrPaymentOptions(quote(offers), [1]).map(row => row.chain)).toEqual([10]);
  });

  it("snapshots picker options so the provider object cannot alter a reviewed offer", () => {
    const provider = payment();
    const [option] = relayrPaymentOptions(quote([provider]), [1]);
    provider.amount = "99";
    expect(option.amount).toBe("1000000000000000");
    expect(Object.isFrozen(option)).toBe(true);
  });

  it("keeps mainnets and testnets separate and rejects duplicate destination sets", () => {
    expect(relayrPaymentChains([1, 10])).toEqual([1, 10, 8453, 42161]);
    expect(relayrPaymentChains([11155111])).toEqual([11155111, 11155420, 84532, 421614]);
    expect(isRelayrChainSet([1, 1])).toBe(false);
    expect(isRelayrChainSet([1, 11155111])).toBe(false);
    expect(isRelayrChainSet([])).toBe(false);
  });
});

describe("destination receipt lookup hints", () => {
  it("never interprets a provider success label as execution proof", () => {
    expect(relayrDestinationHash({ ...record(), status: { state: "Success" } })).toBeNull();
    expect(relayrDestinationHash({ ...record(), status: { state: "Pending", data: { hash: HASH_A } } })).toBe(HASH_A);
    expect(relayrDestinationHash({ ...record(), status: { data: { transaction: { hash: HASH_B } } } })).toBe(HASH_B);
  });

  it.each([
    { hash: "0x1234" as Hex },
    { hash: HASH_A, transaction: { hash: HASH_B } },
    { hash: HASH_A, transaction: { hash: "0x1234" as Hex } },
  ])("rejects malformed or conflicting hash hints", data => {
    expect(relayrDestinationHash({ ...record(), status: { state: "Success", data } })).toBeNull();
  });
});
