import { formatUnits } from "viem";

export type TrendingProject = {
  projectId: number;
  chainId: number;
  name: string | null;
  balance: string;
  tokenSymbol: string | null;
  decimals: number | null;
  currency: string | null;
  deployErc20Events: { items: { symbol: string }[] };
};
export type TrendingData = {
  suckerGroups: { totalCount?: number; items: { id: string; projects: { items: TrendingProject[] } }[] };
};
export type TrendingMachine = { id: string; name: string; ticker: string; balance: string; fullBalance: string; projectId?: number; chainId?: number; groupId?: string };

export function trendingMachines(data: TrendingData): TrendingMachine[] {
  return data.suckerGroups.items.flatMap((group) => {
    const projects = group.projects.items;
    const project = projects[0];
    if (!project) return [];
    // tokenSymbol describes the backing asset; the issued ticker comes from ERC-20 deployment.
    const ticker = projects.flatMap((p) => p.deployErc20Events.items)[0]?.symbol.trim().replace(/^\$+/, "") || "—";
    const balances = new Map<string, { amount: bigint; decimals: number; symbol: string }>();
    let missingBalance = false;
    for (const p of projects) {
      if (p.decimals === null || !Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 255 || !p.tokenSymbol || !/^\d+$/.test(p.balance)) {
        missingBalance = true;
        continue;
      }
      const key = `${p.currency}:${p.decimals}:${p.tokenSymbol}`;
      const total = balances.get(key) ?? { amount: 0n, decimals: p.decimals, symbol: p.tokenSymbol };
      total.amount += BigInt(p.balance);
      balances.set(key, total);
    }
    const amounts = [...balances.values()];
    const balance = amounts.map(({ amount, decimals, symbol }) => {
      const n = Number(formatUnits(amount, decimals));
      const formatted = n > 0 && n < 0.0001 ? "<0.0001" : new Intl.NumberFormat("en-US", {
        notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: n < 1 ? 4 : 2,
      }).format(n);
      return `${formatted} ${symbol}`;
    }).join(" + ");
    return [{
      id: group.id, groupId: group.id, projectId: project.projectId, chainId: project.chainId,
      name: projects.find((p) => p.name)?.name ?? `Project #${project.projectId}`,
      ticker,
      balance: missingBalance ? "—" : balance || "—",
      fullBalance: missingBalance ? "Balance unavailable" : amounts.map(({ amount, decimals, symbol }) => `${formatUnits(amount, decimals)} ${symbol}`).join(" + "),
    }];
  });
}

export type LatestData = { activityEvents: { totalCount?: number; items: {
  id: string; projectId: number; chainId?: number; timestamp: number; project: { name: string | null; suckerGroupId?: string | null } | null;
  payEvent: object | null; cashOutTokensEvent: object | null; swapEvent: { direction: string } | null;
  sendPayoutsEvent: object | null; rulesetQueuedEvent: object | null;
  projectCreateEvent: object | null; addToBalanceEvent: object | null;
}[] } };

export function latestActivity(data: LatestData, now = Date.now() / 1000): TrendingMachine[] {
  return data.activityEvents.items.map(event => {
    const age = Math.max(0, Math.floor(now - event.timestamp));
    const when = age < 60 ? "NOW" : age < 3600 ? `${Math.floor(age / 60)}M` : age < 86400 ? `${Math.floor(age / 3600)}H` : `${Math.floor(age / 86400)}D`;
    const action = event.payEvent ? "PAID TO ISSUE" : event.cashOutTokensEvent ? "CASH OUT" : event.swapEvent ? "PAID TO SWAP" : event.sendPayoutsEvent ? "PAYOUT" : event.rulesetQueuedEvent ? "RULES QUEUED" : event.projectCreateEvent ? "CREATED" : "BACKING ADDED";
    return { id: event.id, projectId: event.projectId, chainId: event.chainId, groupId: event.project?.suckerGroupId??undefined, name: event.project?.name ?? `Project #${event.projectId}`, ticker: when, balance: action, fullBalance: `${action}, ${when === "NOW" ? "just now" : when + " ago"}` };
  });
}
