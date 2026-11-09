// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineDeploySession } from "@/lib/plugin/deploy-session";
import { buildManual } from "@/lib/plugin/manual";
import type { MachineDraft } from "@/lib/plugin/types";

const saved = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }), useEnsName: () => ({ data: undefined }) }));
vi.mock("@/components/SignIn", () => ({ SignIn: () => null }));
vi.mock("@/components/create/DoublingChart", () => ({ DoublingChart: () => null }));
vi.mock("@/components/create/IssuancePie", () => ({ IssuancePie: () => null }));
vi.mock("@/lib/plugin/deploy", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/plugin/deploy")>(), deploymentCashOutTaxRate: () => 0 }));
vi.mock("@/hooks/useDeployMachine", () => ({
  useDeployMachine: () => {
    const [session, setSession] = useState(saved.session as MachineDeploySession | null);
    return { deploy: vi.fn(), session, steps: session?.steps ?? [], busy: false, restoring: false, storageBlocked: false, error: null, progress: null,
      canClear: true, clear: async () => setSession(null), approval: null, answerApproval: vi.fn() };
  },
}));
const { CreateForm } = await import("@/components/create/CreateForm");

const draft: MachineDraft = { name: "Foraging Bot", id: "FORAGE", goal: "Find food.", address: "0x2222222222222222222222222222222222222222",
  keepPercent: 32, doubling: "1m", routes: [], chainIds: [11155111, 84532] };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([
  ["an edited", "Edited manual", "Edited manual"],
  ["the generated", null, null],
])("keeps the saved setup and %s manual when changing setup after a reload", async (_label, manual, expectedEdit) => {
  saved.session = { phase: "signing", transport: "relayr", account: "0x1111111111111111111111111111111111111111", draft, manual: manual ?? buildManual(draft),
    calls: [{ chainId: 11155111 }, { chainId: 84532 }], steps: [{ chainId: 11155111, label: "Sepolia", status: "pending" }, { chainId: 84532, label: "Base Sepolia", status: "pending" }] };
  await act(async () => root.render(createElement(CreateForm)));
  const change = [...container.querySelectorAll("button")].find(button => button.textContent === "Change setup")!;
  await act(async () => change.click());
  expect(container.querySelector<HTMLInputElement>("#name")!.value).toBe("Foraging Bot");
  expect(container.querySelector<HTMLInputElement>("#symbol")!.value).toBe("FORAGE");
  expect(container.querySelector("fieldset")!.disabled).toBe(false);
  expect(container.querySelector<HTMLSelectElement>("#deploy-environment")!.value).toBe("testnet");
  expect(container.querySelector<HTMLSelectElement>("#cut")!.value).toBe("32");
  const manualField = container.querySelector<HTMLTextAreaElement>("#manual");
  expect(manualField?.value).toBe(expectedEdit ?? buildManual(draft));
});
