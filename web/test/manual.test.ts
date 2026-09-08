import { describe, expect, it } from "vitest";

import { buildManual, withDeploymentReferences } from "@/lib/plugin/manual";
import type { MachineDraft } from "@/lib/plugin/types";

const draft: MachineDraft = {
  name: "Foraging Bot",
  id: "forage",
  goal: "Find food. ![shot](data:image/png;base64,AAAA)",
  address: "0xabc",
  keepPercent: 32,
  doubling: "1w",
  routes: [
    { machine: { name: "Revnet", symbol: "REV", ids: { 1: 3 } }, percent: 10, locked: false },
    { machine: { name: "Banny Retail", symbol: "BAN", ids: { 1: 4 } }, percent: 25, locked: true },
  ],
  chainIds: [1, 10, 8453, 42161],
};

describe("buildManual", () => {
  it("leads with the goal, images stripped", () => {
    const manual = buildManual(draft);
    expect(manual.startsWith("GOAL\nFind food.")).toBe(true);
    expect(manual).not.toContain("data:image");
  });

  it("includes the Plug In site and source alongside protocol references", () => {
    const manual = buildManual(draft);
    expect(manual).toContain("https://plugin.money");
    expect(manual).toContain("https://github.com/mejango/plugin");
    expect(manual).toContain("https://revnet.money");
    expect(manual).toContain("https://github.com/Bananapus/version-6");
  });

  it("upper-cases the ticker and carries the address", () => {
    const manual = buildManual(draft);
    expect(manual).toContain("You are Foraging Bot (FORAGE)");
    expect(manual).toContain("paid to 0xabc");
  });

  it("states each economic figure exactly once, under MACHINE FACTS", () => {
    const manual = buildManual(draft);
    // The whole point of the canonical block: no figure restated elsewhere.
    expect(manual.match(/32% of all issuance/g)).toHaveLength(1);
    expect(manual.match(/doubles every week/g)).toHaveLength(1);
    expect(manual.match(/30% tax/g)).toHaveLength(1);
  });

  it("renders one line per route, flagging locked ones", () => {
    const manual = buildManual(draft);
    expect(manual).toContain("- Route: 10% of the keep flows onward to Revnet (REV);");
    expect(manual).toContain("Banny Retail (BAN), locked forever;");
  });

  it("falls back to placeholders when the draft is empty", () => {
    const manual = buildManual({ ...draft, name: "", id: "", address: "", goal: "", routes: [] });
    expect(manual).toContain("[machine name]");
    expect(manual).toContain("[ID]");
    expect(manual).toContain("[your goal");
    expect(manual).not.toContain("- Route:");
  });
});

describe("deployed manual references", () => {
  it("preserves custom instructions and includes exact chain-specific IDs only after confirmation", () => {
    const custom = "GOAL\nKeep my custom instructions.";
    const steps = [
      { chainId: 1, label: "Ethereum", status: "done" as const, projectId: "9007199254740993" },
      { chainId: 8453, label: "Base", status: "done" as const, projectId: "27" },
      { chainId: 10, label: "Optimism", status: "confirming" as const, projectId: "99" },
    ];
    const result = withDeploymentReferences(custom, steps);
    expect(result.startsWith(custom)).toBe(true);
    expect(result).toContain("Ethereum (chain ID 1): project ID 9007199254740993");
    expect(result).toContain("https://revnet.money/base:27");
    expect(result).toContain("Optimism (chain ID 10): deployment not confirmed");
    expect(result).not.toContain("project ID 99");
    expect(withDeploymentReferences(custom, [])).toBe(custom);
  });
  it("describes only selected chains before deployment and labels the operator correctly", () => {
    const manual = buildManual({ ...draft, chainIds: [8453] });
    expect(manual).toContain("operator wallet is 0xabc");
    expect(manual).toContain("Planned deployment chains: Base (8453)");
    expect(manual).not.toContain("live on Ethereum");
  });
});
