// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectRow } from "@/lib/bendystraw/operations";
import { RoutesPanel } from "@/components/create/RoutesPanel";

const mocks = vi.hoisted(() => ({ search: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/machines", () => ({ searchMachines: mocks.search, resolveChainIds: mocks.resolve }));

const row = (projectId: number, name: string): ProjectRow => ({ projectId, chainId: 1, suckerGroupId: null, name, tokenSymbol: name, decimals: 18, isRevnet: true });
let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>("input[type=text]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
const result = (name: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(name))!;

it("adds one route at a time while a pick is resolving", async () => {
  let finish!: (ids: Record<number, number>) => void;
  mocks.search.mockResolvedValue([row(1, "Alpha"), row(2, "Beta")]);
  mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(createElement(RoutesPanel, { routes: [], keepPercent: 10, onChange })));
  await type("machine");
  await act(async () => { result("Alpha").click(); });
  expect(result("Beta").disabled).toBe(true);
  await act(async () => { result("Beta").click(); });
  await act(async () => finish({ 1: 1 }));
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].map((route: { machine: { name: string } }) => route.machine.name)).toEqual(["Alpha"]);
});

it("says so when a picked machine cannot be resolved", async () => {
  mocks.search.mockResolvedValue([row(1, "Alpha")]);
  mocks.resolve.mockRejectedValueOnce(new Error("bendystraw down"));
  await act(async () => root.render(createElement(RoutesPanel, { routes: [], keepPercent: 10, onChange })));
  await type("machine");
  await act(async () => { result("Alpha").click(); });
  expect(onChange).not.toHaveBeenCalled();
  expect(container.querySelector("[role=alert]")?.textContent).toBe("Could not plug in that machine. Try again.");
  expect(result("Alpha").disabled).toBe(false);
});
