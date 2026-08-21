/**
 * The house rules, in one place. These mirror PluginDeployer's enums exactly —
 * the contract is the authority, this is its vocabulary for the UI.
 */

/** PluginKeep. Order IS the enum's order; the index is what goes onchain. */
export const KEEPS = [
  { percent: 0, label: "0% — keeps nothing" },
  { percent: 10, label: "10% — just a bit" },
  { percent: 32, label: "32% — a good bit" },
  { percent: 50, label: "50% — half and half" },
  { percent: 68, label: "68% — the bulk of it" },
  { percent: 90, label: "90% — all but a bit" },
] as const;

/** PluginDoubling. Order IS the enum's order. */
export const DOUBLINGS = [
  { key: "1d", label: "Daily", days: 1, word: "day" },
  { key: "1w", label: "Weekly", days: 7, word: "week" },
  { key: "1m", label: "Monthly", days: 30, word: "month" },
  { key: "3m", label: "Quarterly", days: 91, word: "quarter" },
] as const;

export type DoublingKey = (typeof DOUBLINGS)[number]["key"];

export const DEFAULT_KEEP_PERCENT = 10;
export const DEFAULT_DOUBLING: DoublingKey = "1m";

/** Tokens issued per USD at the start; doublings scale the price from here. */
export const INITIAL_ISSUANCE_PER_USD = 1000;

export function keepIndex(percent: number): number {
  const i = KEEPS.findIndex((k) => k.percent === percent);
  if (i < 0) throw new Error(`no keep option for ${percent}%`);
  return i;
}

export function doublingIndex(key: DoublingKey): number {
  const i = DOUBLINGS.findIndex((d) => d.key === key);
  if (i < 0) throw new Error(`no doubling option for ${key}`);
  return i;
}

export function doublingFor(key: DoublingKey) {
  return DOUBLINGS[doublingIndex(key)];
}

/** Price to issue one token at a moment in the machine's life. */
export function issuancePriceAt(doubling: DoublingKey, day: number): number {
  const doublings = Math.floor(day / doublingFor(doubling).days);
  return (1 / INITIAL_ISSUANCE_PER_USD) * 2 ** doublings;
}

/** Tokens a dollar mints at a moment in the machine's life. */
export function tokensPerDollarAt(doubling: DoublingKey, day: number): number {
  const doublings = Math.floor(day / doublingFor(doubling).days);
  return INITIAL_ISSUANCE_PER_USD / 2 ** doublings;
}
