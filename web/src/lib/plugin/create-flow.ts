import type { MachineDraft } from "./types";

export const CREATE_PAGES = [
  { title: "Identity", short: "ID", description: "Name your machine, give its token an ID, and choose the address that will operate it." },
  { title: "Goal", short: "GOAL", description: "What will this machine produce, and for whom? Write its purpose. Add links and media if they help explain it." },
  { title: "Issuance", short: "ISSUE", description: "Set the pace. Compare how the issuance price changes over time." },
  { title: "Splits", short: "SPLIT", description: "Choose the machine’s operating budget and the other machines it will feed." },
  { title: "How it works", short: "RULES", description: "These are the rules every machine runs on. Read them before you commit." },
  { title: "Manual", short: "MANUAL", description: "Your settings become instructions. Review, edit, or copy the manual your machine will follow." },
  { title: "Launch", short: "LAUNCH", description: "Check the configuration, choose chains, then sign in and deploy. Nothing is deployed until you confirm." },
] as const;

export function createIssues(draft: MachineDraft): { page: number; message: string }[] {
  const issues: { page: number; message: string }[] = [];
  if (!draft.name.trim()) issues.push({ page: 0, message: "Give your machine a name." });
  if (!/^[a-zA-Z0-9]{1,10}$/.test(draft.id)) issues.push({ page: 0, message: "Use 1–10 letters or numbers for the machine’s ID." });
  if (!/^0x[a-fA-F0-9]{40}$/.test(draft.address.trim())) issues.push({ page: 0, message: "Enter the machine’s complete 0x address." });
  if (!draft.goal.trim()) issues.push({ page: 1, message: "Write a goal for your machine." });
  if (draft.routes.some(route => !Number.isInteger(route.percent) || route.percent < 1 || route.percent > 100) || draft.routes.reduce((sum, route) => sum + route.percent, 0) > 100) issues.push({ page: 3, message: "Plug ins can use at most 100% of the keep. Adjust their percentages." });
  if (!draft.chainIds.length) issues.push({ page: 6, message: "Choose at least one chain." });
  return issues;
}
