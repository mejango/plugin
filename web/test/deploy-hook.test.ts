// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { runMachineDeployment } from "@/lib/plugin/relayr-deploy";
import { useDeployMachine } from "@/hooks/useDeployMachine";

const mocks = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn(), clear: vi.fn(), canClear: vi.fn(), done: vi.fn() }));
vi.mock("wagmi", () => ({ useConfig: () => ({}), useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }) }));
vi.mock("@/lib/plugin/deploy-session", () => ({ loadMachineDeployment: mocks.load, clearMachineDeployment: mocks.clear, canClearMachineDeployment: mocks.canClear, machineDeploymentDone: mocks.done }));
vi.mock("@/lib/plugin/relayr-deploy", () => ({ runMachineDeployment: mocks.run }));

type RunArgs = Parameters<typeof runMachineDeployment>[0];
let api: ReturnType<typeof useDeployMachine>;
let root: Root | null;
let container: HTMLDivElement;
function Harness() {
  const current = useDeployMachine();
  useLayoutEffect(() => { api = current; });
  return null;
}
async function mount() {
  await act(async () => {
    root!.render(createElement(Harness));
    await vi.dynamicImportSettled();
  });
  expect(api.restoring).toBe(false);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.load.mockReturnValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("deployment UI lifecycle", () => {
  it("waits for the engine's returned quote before opening the funding picker and suppresses duplicate starts", async () => {
    let returnQuote!: () => void;
    const quotePending = new Promise<void>(resolve => { returnQuote = resolve; });
    const choice = vi.fn();
    mocks.run.mockImplementation(async (args: RunArgs) => {
      await quotePending;
      choice(await args.chooseFunding([{chainId: 84532, label: "Base Sepolia — 0.0004 ETH"}]));
    });
    await mount();
    let running!: Promise<void>;
    await act(async () => { running = api.deploy(); void api.deploy(); await vi.dynamicImportSettled(); });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(api.approval).toBeNull();
    expect(api.busy).toBe(true);
    await act(async () => { returnQuote(); await Promise.resolve(); });
    expect(api.approval).toMatchObject({kind: "funding", options: [{chainId: 84532, label: "Base Sepolia — 0.0004 ETH"}]});
    const id = api.approval!.id;
    await act(async () => { api.answerApproval(id + 1, 1); });
    expect(choice).not.toHaveBeenCalled();
    await act(async () => { api.answerApproval(id, 84532); await running; });
    expect(choice).toHaveBeenCalledExactlyOnceWith(84532);
    expect(api.approval).toBeNull();
    expect(api.busy).toBe(false);
  });

  it("cancels a pending choice if the deployment UI unmounts", async () => {
    const choice = vi.fn();
    mocks.run.mockImplementation(async (args: RunArgs) => {
      choice(await args.chooseFunding([{chainId: 1, label: "Ethereum — 0.001 ETH"}]));
    });
    await mount();
    let running!: Promise<void>;
    await act(async () => { running = api.deploy(); await vi.dynamicImportSettled(); });
    expect(api.approval?.kind).toBe("funding");
    await act(async () => { root!.unmount(); root = null; await running; });
    expect(choice).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("shows the SDK's check only when the engine stops on an unprovable payment, and resumes once it is retired", async () => {
    const attempt = { chainId: 8453, account: "0x1111111111111111111111111111111111111111", namespaces: ["machine-relayr-payment"] };
    mocks.run.mockRejectedValueOnce(Object.assign(new Error("Your wallet may have sent the Relayr payment without returning its hash."), { name: "SavedAttemptShownError", attempt }));
    await mount();
    expect(api.recovery).toBeNull();
    await act(async () => { await api.deploy(); });
    expect(api.recovery).toBe(attempt);
    mocks.run.mockResolvedValueOnce(undefined);
    await act(async () => { api.onRecoveryRetired(); await vi.dynamicImportSettled(); });
    expect(api.recovery).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it.each(["a manual resume completes the deployment", "the saved deployment is cleared"])("drops the shown check once %s", async outcome => {
    const attempt = { chainId: 8453, account: "0x1111111111111111111111111111111111111111", namespaces: ["machine-relayr-payment"] };
    mocks.run.mockRejectedValueOnce(Object.assign(new Error("Your wallet may have sent the Relayr payment without returning its hash."), { name: "SavedAttemptShownError", attempt }));
    await mount();
    await act(async () => { await api.deploy(); });
    expect(api.recovery).toBe(attempt);
    mocks.run.mockResolvedValueOnce(undefined);
    mocks.clear.mockResolvedValueOnce(undefined);
    await act(async () => { await (outcome.startsWith("a manual") ? api.deploy() : api.clear()); });
    expect(api.recovery).toBeNull();
  });

  it("keeps the check hidden for any other deployment error", async () => {
    mocks.run.mockRejectedValueOnce(new Error("Relayr returned no usable payment options."));
    await mount();
    await act(async () => { await api.deploy(); });
    expect(api.recovery).toBeNull();
    expect(api.error).toBe("Relayr returned no usable payment options.");
  });

  it("blocks new deployment when saved recovery data cannot be read", async () => {
    mocks.load.mockImplementation(() => { throw new Error("The saved deployment is invalid."); });
    await mount();
    expect(api.storageBlocked).toBe(true);
    expect(api.error).toBe("The saved deployment is invalid.");
    await act(async () => { await api.deploy(); });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
