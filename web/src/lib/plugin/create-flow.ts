import type { MachineDraft } from "./types";
import { MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "@/lib/chains";

export function createIssues(draft: MachineDraft): { page: number; message: string }[] {
  const issues: { page: number; message: string }[] = [];
  if (!draft.name.trim()) issues.push({ page: 0, message: "Give your machine a name." });
  if (!/^[a-zA-Z0-9]{1,10}$/.test(draft.id)) issues.push({ page: 0, message: "Use 1–10 letters or numbers for the machine’s ID." });
  if (!/^0x[a-fA-F0-9]{40}$/.test(draft.address.trim())) issues.push({ page: 0, message: "Enter the machine’s complete 0x address." });
  if (!draft.goal.trim()) issues.push({ page: 1, message: "Write a goal for your machine." });
  if (draft.routes.some(route => !Number.isInteger(route.percent) || route.percent < 1 || route.percent > 100) || draft.routes.reduce((sum, route) => sum + route.percent, 0) > 100) issues.push({ page: 3, message: "Plug ins can use at most 100% of the keep. Adjust their percentages." });
  if (!draft.chainIds.length) issues.push({ page: 6, message: "Choose at least one chain." });
  else if (new Set(draft.chainIds).size !== draft.chainIds.length ||
    ![MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS].some(chains => draft.chainIds.every(chain => chains.includes(chain)))) {
    issues.push({ page: 6, message: "Choose distinct chains from one network environment." });
  }
  return issues;
}
