import { formatEther, isAddress, type Address, type Hex } from "viem";

const RELAYR_API = "https://api.relayr.ba5ed.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^0x(?:[0-9a-f]{2})*$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const MAINNETS = [1, 10, 8453, 42161] as const;
const TESTNETS = [11155111, 11155420, 84532, 421614] as const;
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum", 10: "Optimism", 8453: "Base", 42161: "Arbitrum",
  11155111: "Sepolia", 11155420: "Optimism Sepolia", 84532: "Base Sepolia", 421614: "Arbitrum Sepolia",
};

// Pinned immutable prepaid-native endpoint; quotes never choose a wallet target.
export const RELAYR_PAYMENT_ADDRESS = "0x1c05f7841379d4393574c0ffa17908ec40ffd97d" as Address;
export const RELAYR_PAYMENT_SELECTOR = "0x103903a7";
export const RELAYR_PAYMENT_CODE_HASH = "0x6006b5acadb4cd60aa5c00cb844c34563e182dff83d4f4ff4fde226f7df16fa6" as Hex;
export const RELAYR_NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address;
export const RELAYR_PAYMENT_GAS = 150_000n;
export const RELAYR_PAYMENT_CODE_MAX_BYTES = 2_048;

export type RelayrEntry = { chain: number; target: Address; data: Hex; value: string; virtual_nonce?: number };
export type RelayrPayment = {
  chain: number; amount: string; calldata: Hex; target: Address;
  token?: Address; payment_deadline?: number | string;
};
export type RelayrPaymentDetails = {
  chainId: number; target: Address; amount: bigint; calldata: Hex; bundleUuid: string; deadline: bigint;
};
export type RelayrTransactionRecord = {
  chain?: number; tx_uuid: string; request: RelayrEntry;
  status?: { state?: string; data?: { hash?: Hex; transaction?: { hash?: Hex } } };
};
export type RelayrUnboundQuote = { bundle_uuid: string; payment_info: RelayrPayment[]; tx_uuids: string[] };
export type RelayrQuote = {
  bundle_uuid: string; payment_info: RelayrPayment[]; transactions?: RelayrTransactionRecord[];
  /** Bound to exact client requests by membership, never by provider array order. */
  expectedTransactions: { txUuid: string; chain: number; entry: RelayrEntry }[];
};

export function relayrPaymentChains(chainIds: readonly number[]): number[] {
  if (!chainIds.length || chainIds.some(id => !Number.isSafeInteger(id))) return [];
  for (const family of [MAINNETS, TESTNETS]) {
    if (chainIds.every(id => (family as readonly number[]).includes(id))) return [...family];
  }
  return [];
}

export function isRelayrChainSet(chainIds: readonly number[]): boolean {
  return new Set(chainIds).size === chainIds.length && relayrPaymentChains(chainIds).length > 0;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Relayr returned a malformed response.");
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value.toLowerCase())) throw new Error("Relayr returned an invalid bundle or transaction ID.");
  return value.toLowerCase();
}

function unsigned(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 78 || !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(value)) throw new Error("Relayr returned an invalid payment or call amount.");
  const amount = BigInt(value);
  if (amount >= 2n ** 256n) throw new Error("Relayr returned an invalid payment or call amount.");
  return amount;
}

function entrySnapshot(value: unknown): RelayrEntry {
  const row = object(value);
  if (typeof row.chain !== "number" || !relayrPaymentChains([row.chain]).length ||
      typeof row.target !== "string" || !isAddress(row.target) ||
      typeof row.data !== "string" || !HEX.test(row.data) ||
      (row.virtual_nonce !== undefined && (!Number.isSafeInteger(row.virtual_nonce) || Number(row.virtual_nonce) < 0))) {
    throw new Error("Relayr returned an invalid transaction request.");
  }
  return {
    chain: row.chain, target: row.target.toLowerCase() as Address,
    data: row.data.toLowerCase() as Hex, value: unsigned(row.value).toString(),
    ...(row.virtual_nonce !== undefined ? { virtual_nonce: Number(row.virtual_nonce) } : {}),
  };
}

function orderedEntries(entries: readonly RelayrEntry[]): RelayrEntry[] {
  if (!entries.length || !isRelayrChainSet([...new Set(entries.map(entry => entry.chain))])) {
    throw new Error("Choose supported Relayr destinations from one network family.");
  }
  const nextNonce = new Map<number, number>();
  return entries.map(entry => {
    const nonce = nextNonce.get(entry.chain) ?? 0;
    nextNonce.set(entry.chain, nonce + 1);
    return entrySnapshot({ ...entry, virtual_nonce: nonce });
  });
}

function entryKey(entry: RelayrEntry): string {
  return JSON.stringify([entry.chain, entry.target, entry.data, entry.value, entry.virtual_nonce]);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function paymentSnapshots(value: unknown): RelayrPayment[] {
  if (!Array.isArray(value)) throw new Error("Relayr returned no payment options.");
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.chain !== "number" || typeof row.amount !== "string" || typeof row.calldata !== "string" || typeof row.target !== "string") return [];
    return [{
      chain: row.chain, amount: row.amount, calldata: row.calldata as Hex, target: row.target as Address,
      ...(typeof row.token === "string" ? { token: row.token as Address } : {}),
      ...(typeof row.payment_deadline === "string" || typeof row.payment_deadline === "number" ? { payment_deadline: row.payment_deadline } : {}),
    }];
  });
}

function unboundSnapshot(value: unknown, count: number): RelayrUnboundQuote {
  const body = object(value);
  const current = body.tx_uuids;
  const legacy = body.txn_uuids;
  if (current !== undefined && !Array.isArray(current) || legacy !== undefined && !Array.isArray(legacy)) throw new Error("Relayr returned invalid transaction IDs.");
  const ids = (current ?? legacy) as unknown;
  if (!Array.isArray(ids) || ids.length !== count) throw new Error("Relayr did not return every transaction ID.");
  const txUuids = ids.map(uuid);
  if (new Set(txUuids).size !== count) throw new Error("Relayr returned duplicate transaction IDs.");
  if (Array.isArray(current) && Array.isArray(legacy) && JSON.stringify(current.map(uuid)) !== JSON.stringify(legacy.map(uuid))) throw new Error("Relayr returned conflicting transaction IDs.");
  return freeze({ bundle_uuid: uuid(body.bundle_uuid), payment_info: paymentSnapshots(body.payment_info), tx_uuids: txUuids });
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.method === "POST" ? 45_000 : 15_000);
  try {
    const response = await fetch(`${RELAYR_API}${path}`, { ...init, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`Relayr HTTP ${response.status}. Check the saved deployment before trying again.`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Relayr did not respond in time. Check the saved deployment; published requests must not be submitted again.");
    throw error;
  } finally { clearTimeout(timer); }
}

function statusRecords(value: unknown, bundleUuid: string): RelayrTransactionRecord[] {
  const body = object(value);
  if (uuid(body.bundle_uuid) !== bundleUuid || !Array.isArray(body.transactions)) throw new Error("Relayr status does not match this bundle.");
  const seen = new Set<string>();
  return body.transactions.map(item => {
    const row = object(item);
    const txUuid = uuid(row.tx_uuid);
    const entry = entrySnapshot(row.request);
    if (seen.has(txUuid) || row.chain !== undefined && row.chain !== entry.chain) throw new Error("Relayr returned conflicting transaction records.");
    seen.add(txUuid);
    const record: RelayrTransactionRecord = { tx_uuid: txUuid, request: entry };
    if (row.status !== undefined) {
      const state = object(row.status);
      record.status = {};
      if (typeof state.state === "string") record.status.state = state.state;
      if (state.data && typeof state.data === "object") {
        const data = object(state.data);
        record.status.data = {};
        if (typeof data.hash === "string") record.status.data.hash = data.hash as Hex;
        if (data.transaction && typeof data.transaction === "object") {
          const transaction = object(data.transaction);
          if (typeof transaction.hash === "string") record.status.data.transaction = { hash: transaction.hash as Hex };
        }
      }
    }
    return record;
  });
}

/** A quote response contains UUIDs only. Read exact requests before accepting its payment options. */
export async function bindRelayrQuote(unbound: RelayrUnboundQuote, entries: readonly RelayrEntry[]): Promise<RelayrQuote> {
  const ordered = orderedEntries(entries);
  const snapshot = unboundSnapshot(unbound, ordered.length);
  const records = statusRecords(await request(`/v1/bundle/${snapshot.bundle_uuid}`), snapshot.bundle_uuid);
  if (records.length !== ordered.length) throw new Error("Relayr has not returned every quoted request. Resume this saved bundle to check again.");
  const ids = new Set(snapshot.tx_uuids);
  const byRequest = new Map<string, RelayrTransactionRecord>();
  for (const record of records) {
    const key = entryKey(record.request);
    if (!ids.has(record.tx_uuid) || byRequest.has(key)) throw new Error("Relayr did not uniquely bind every quoted request.");
    byRequest.set(key, record);
  }
  const expectedTransactions = ordered.map(entry => {
    const match = byRequest.get(entryKey(entry));
    if (!match) throw new Error("Relayr's quoted request differs from the signed deployment.");
    return { txUuid: match.tx_uuid, chain: entry.chain, entry };
  });
  return freeze({ bundle_uuid: snapshot.bundle_uuid, payment_info: snapshot.payment_info, transactions: records, expectedTransactions });
}

export async function postRelayrBundle(entries: readonly RelayrEntry[], onPublished?: (quote: RelayrUnboundQuote) => void | Promise<void>): Promise<RelayrQuote> {
  const ordered = orderedEntries(entries);
  const body = await request("/v1/bundle/prepaid", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: ordered, virtual_nonce_mode: "ChainIndependent" }),
  });
  const quote = unboundSnapshot(body, ordered.length);
  // Save the known UUID before the read-only binding request can fail.
  await onPublished?.(quote);
  return bindRelayrQuote(quote, ordered);
}

/** Partial status is pending. Unknown IDs or changed requests never become execution evidence. */
export async function fetchRelayrStatus(quote: RelayrQuote): Promise<RelayrTransactionRecord[]> {
  const bundleUuid = uuid(quote.bundle_uuid);
  if (!Array.isArray(quote.expectedTransactions) || !quote.expectedTransactions.length) throw new Error("This saved Relayr bundle lacks authenticated destination requests.");
  const expected = new Map<string, string>();
  const keys = new Set<string>();
  for (const binding of quote.expectedTransactions) {
    const entry = entrySnapshot(binding.entry);
    const id = uuid(binding.txUuid);
    const key = entryKey(entry);
    if (binding.chain !== entry.chain || expected.has(id) || keys.has(key)) throw new Error("This saved Relayr bundle has conflicting destination requests.");
    expected.set(id, key);
    keys.add(key);
  }
  const records = statusRecords(await request(`/v1/bundle/${bundleUuid}`), bundleUuid);
  for (const record of records) {
    if (expected.get(record.tx_uuid) !== entryKey(record.request)) throw new Error("Relayr status does not match the authenticated deployment requests.");
  }
  return freeze(records);
}

function deadlineSeconds(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value) && value.length < 17) return BigInt(value);
  const milliseconds = typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Relayr returned an invalid payment deadline.");
  return BigInt(Math.floor(milliseconds / 1_000));
}

/** Parse the exact immutable transaction tuple that the wallet will review and pay. */
export function paymentDetails(payment: RelayrPayment, expectedBundleUuid: string, options: { allowExpired?: boolean } = {}): RelayrPaymentDetails {
  if (!payment || !Number.isSafeInteger(payment.chain) || !relayrPaymentChains([payment.chain]).length) throw new Error("Relayr returned an unsupported payment chain.");
  if (typeof payment.target !== "string" || payment.target.toLowerCase() !== RELAYR_PAYMENT_ADDRESS) throw new Error("Relayr returned an unrecognized payment contract.");
  if (typeof payment.token !== "string" || payment.token.toLowerCase() !== RELAYR_NATIVE_TOKEN) throw new Error("Relayr returned an unsupported payment token.");
  const amount = unsigned(payment.amount);
  const bundleUuid = uuid(expectedBundleUuid);
  const calldata = typeof payment.calldata === "string" ? payment.calldata.toLowerCase() : "";
  if (!/^0x[0-9a-f]{136}$/.test(calldata) || calldata.slice(0, 10) !== RELAYR_PAYMENT_SELECTOR) throw new Error("Relayr returned invalid payment calldata.");
  if (calldata.slice(10, 74) !== `${bundleUuid.replaceAll("-", "")}${"0".repeat(32)}`) throw new Error("Relayr payment calldata does not match this bundle.");
  const deadline = BigInt(`0x${calldata.slice(74)}`);
  if (deadline > 0xffffffffffn || deadlineSeconds(payment.payment_deadline) !== deadline) throw new Error("Relayr payment calldata does not match its deadline.");
  if (!options.allowExpired && deadline <= BigInt(Math.floor(Date.now() / 1_000) + 15)) throw new Error("This Relayr quote expired. Check the saved deployment before requesting another quote.");
  return freeze({ chainId: payment.chain, target: RELAYR_PAYMENT_ADDRESS, amount, calldata: calldata as Hex, bundleUuid, deadline });
}

/** Only authenticated offers in the destination network family reach the picker. */
export function relayrPaymentOptions(quote: RelayrQuote, chainIds: readonly number[]): RelayrPayment[] {
  const allowed = relayrPaymentChains(chainIds);
  const options = new Map<number, RelayrPayment>();
  const identities = new Map<number, string>();
  const conflicts = new Set<number>();
  for (const payment of paymentSnapshots(quote.payment_info)) {
    let details: RelayrPaymentDetails;
    try { details = paymentDetails(payment, quote.bundle_uuid); } catch { continue; }
    if (!allowed.includes(details.chainId)) continue;
    const identity = `${details.amount}:${details.calldata}`;
    if (identities.has(details.chainId) && identities.get(details.chainId) !== identity) conflicts.add(details.chainId);
    identities.set(details.chainId, identity);
    options.set(details.chainId, freeze(payment));
  }
  return [...options].filter(([chain]) => !conflicts.has(chain)).map(([, payment]) => payment);
}

export function paymentLabel(payment: RelayrPayment): string {
  return `${CHAIN_NAMES[payment.chain] ?? `Chain ${payment.chain}`} — ${formatEther(unsigned(payment.amount))} ETH`;
}

/** A provider hash is a receipt lookup hint; its state string proves nothing. */
export function relayrDestinationHash(record: RelayrTransactionRecord): Hex | null {
  const direct = record.status?.data?.hash;
  const nested = record.status?.data?.transaction?.hash;
  if (direct !== undefined && (typeof direct !== "string" || !HASH.test(direct))) return null;
  if (nested !== undefined && (typeof nested !== "string" || !HASH.test(nested))) return null;
  if (direct && nested && direct.toLowerCase() !== nested.toLowerCase()) return null;
  return (direct ?? nested)?.toLowerCase() as Hex ?? null;
}
