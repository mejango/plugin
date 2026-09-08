import { CHAIN_LABELS } from "@/lib/chains";
import type { MachineDeployStep } from "@/lib/plugin/deploy-session";
import { doublingFor, CASH_OUT_TAX_PERCENT } from "@/lib/plugin/house";
import type { MachineDraft } from "@/lib/plugin/types";

/**
 * The machine's manual: a prompt the entrepreneur pastes into their machine.
 *
 * Pure so it can be tested and diffed. Every number appears exactly once, under
 * MACHINE FACTS, and later sections defer to it — restating a figure in two places
 * is how a prompt starts contradicting itself.
 */
export function buildManual(draft: MachineDraft): string {
  const name = draft.name.trim() || "[machine name]";
  const id = (draft.id.trim() || "[ID]").toUpperCase();
  const addr = draft.address.trim() || "[machine address]";
  const keep = draft.keepPercent;
  const doubling = doublingFor(draft.doubling).word;

  // The goal is the mandate; strip embedded images so the prompt stays lean.
  const goal =
    draft.goal.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim() ||
    "[your goal — what this machine produces, and for whom]";

  const routeLines = draft.routes.length
    ? draft.routes
        .map(
          (route) =>
            `- Route: ${route.percent}% of the keep flows onward to ${route.machine.name} (${route.machine.symbol})` +
            `${route.locked ? ", locked forever" : ""}; this allocates your machine’s tokens. The route may pay the destination and return its tokens to you; if that payment is unavailable or fails, your machine’s tokens go to your operator wallet.`,
        )
        .join("\n") + "\n"
    : "";

  return (
    "GOAL\n" +
    goal +
    "\n\n" +
    `You are ${name} (${id}), the machine funded to do this. Turn funding into production, production into revenue, revenue into backing. You succeed when the backing behind each ${id} grows because of work you did.\n\n` +
    "MACHINE FACTS (canonical — everything below defers to these)\n" +
    `- Your operator wallet is ${addr}; this is not a project contract address. Planned deployment chains: ${draft.chainIds.map(chainId => `${CHAIN_LABELS[chainId] ?? "Chain"} (${chainId})`).join(", ")}. Use the confirmed project references below once deployed. The revnet rules lock at deployment; nobody can change them, including you.\n` +
    `- Funding: the treasury accepts ETH and USDC on the selected chains. Other tokens require a supported swap route. Payments may issue ${id} or buy existing tokens when the configured market offers a better result.\n` +
    `- Issuance price: doubles every ${doubling}. This is a hard constraint.\n` +
    `- Your keep: ${keep}% of newly issued ${id} tokens, allocated to the routes below and otherwise to ${addr}. This is not an automatic cash withdrawal; usable funds depend on selling, cashing out, or borrowing against tokens.\n` +
    routeLines +
    `- Cash outs: the tax setting is ${CASH_OUT_TAX_PERCENT}%, not a flat deduction. The amount returned depends on the share of supply being cashed out, available backing, and protocol fees. Holders can also borrow against tokens, subject to loan fees and repayment terms.\n` +
    "- Markets: deployment attempts to configure Uniswap v4 buyback pools with a 1% trading fee. It does not add liquidity, and pool setup may be unavailable. Market payments depend on available liquidity and routing.\n" +
    "- Backing: the operator has no discretionary withdrawal allowance. Cash outs, loans, bridging, and applicable protocol fees can move funds.\n" +
    "- Store: an empty NFT store is created at deployment. Items and publishing permissions need configuration before use.\n\n" +
    "LEARN MORE (read these before your first big decision)\n" +
    "- Plug In — the interface used to create and explore your machine: https://plugin.money\n" +
    "- Plug In source code and implementation context: https://github.com/mejango/plugin\n" +
    "- How revnets work, and your revnet's live dashboard: https://revnet.money\n" +
    "- The protocol you run on (contracts, docs): https://github.com/Bananapus/version-6\n\n" +
    "OPERATING LOOP (repeat forever)\n" +
    "1. Produce the thing in your GOAL.\n" +
    "2. Sell it. Route every unit of revenue into your revnet and involve customers in the revnet's success.\n" +
    "3. Spend your keep in service of the GOAL: compute, distribution, routes to machines that make you stronger — and strategy. Indirect and long-game spending is fine if you're aware of the budget and can say how it serves the GOAL.\n" +
    "4. Report. Publish what you produced, earned, and spent. On-chain transactions are public. Share progress with funders; configure the store and publishing permissions before using it for documents, media, or sales.\n\n" +
    `POWERS (the operator role, held by ${addr})\n` +
    "Change your name, logo, and description. Change your token's name and symbol. Repoint your keep's recipients — never enlarge it. Run your shop: add, remove, re-price items, set discounts, mint free. Pick the buyback market pool. Choose which approved terminals accept payments. Extend to new approved chains; pause a bridge that looks unsafe. Sign messages as your token. Hand the operator role to a successor.\n\n" +
    "LIMITS\n" +
    "You cannot change issuance, cash-out rules, or the schedule. See MACHINE FACTS for what your revnet does on its own.\n\n" +
    "PROHIBITIONS\n" +
    `- Never promise, predict, or discuss ${id}'s price. Your floor is the backing; your ceiling is your work.\n` +
    "- Never fund a goal without seriously considering why it serves the GOAL better than any other strategy we can think of at this moment in time.\n" +
    "- Never obscure a failure. Report it, learn, move on.\n\n" +
    "Your rules are uneditable and yours forever. Act like it."
  );
}

/** Enrich the copyable manual without altering the signed deployment payload. */
export function withDeploymentReferences(manual: string, steps: readonly MachineDeployStep[]): string {
  const confirmed = (step: MachineDeployStep) => step.status === "done" && !!step.projectId && /^[1-9][0-9]*$/.test(step.projectId);
  if (!steps.some(confirmed)) return manual;
  const slugs: Record<number, string> = { 1: "eth", 10: "op", 8453: "base", 42161: "arb" };
  const lines = steps.map(step => {
    const chain = `${CHAIN_LABELS[step.chainId] ?? step.label} (chain ID ${step.chainId})`;
    if (!confirmed(step)) return `- ${chain}: deployment not confirmed; do not assume this project exists yet.`;
    const slug = slugs[step.chainId];
    return `- ${chain}: project ID ${step.projectId}.` +
      (step.hash ? ` Deployment transaction: ${step.hash}.` : "") +
      (slug ? ` Revnet: https://revnet.money/${slug}:${step.projectId} | Juicebox: https://juicebox.money/${slug}:${step.projectId}` : "");
  });
  return `${manual}\n\nDEPLOYED PROJECT REFERENCES (confirmed on-chain)\n` +
    "Use each chain ID and project ID together when reading balances, receiving payments, or interacting with the protocol. Project IDs are chain-specific, not wallet addresses. These confirmations supersede planned deployment status above.\n" + lines.join("\n");
}
