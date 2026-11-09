// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BendystrawOperations } from "@/lib/bendystraw/operations";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/bendystraw/client", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/components/BoardKnob", async () => {
  const { createElement } = await import("react");
  return { BoardKnob: ({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) =>
    createElement("button", { type: "button", "data-knob": label, onClick: () => onChange(value + 1) }, label) };
});
const { HomeHero } = await import("@/components/HomeHero");

const project = { projectId: 7, chainId: 1, name: "Alpha", balance: "1", tokenSymbol: "ETH", decimals: 18, currency: "1", deployErc20Events: { items: [] } };
const listCalls = () => mocks.query.mock.calls.filter(([operation]) => operation !== BendystrawOperations.SuckerGroup).length;
const statsCalls = () => mocks.query.mock.calls.filter(([operation]) => operation === BendystrawOperations.SuckerGroup).length;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (operation: string) => {
    if (operation === BendystrawOperations.SuckerGroup) throw new Error("stats down");
    return { suckerGroups: { totalCount: 1, items: [{ id: "g1", projects: { items: [project] } }] }, activityEvents: { totalCount: 0, items: [] } };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const right = () => container.querySelector<HTMLButtonElement>('[data-direction="right"]')!;

it("retries only the failed project stats and drops the retry label when the mode changes", async () => {
  await act(async () => root.render(createElement(HomeHero)));
  expect(container.textContent).toContain("Alpha");
  await act(async () => right().click());
  expect(right().getAttribute("aria-label")).toBe("Retry project stats");
  const before = listCalls();
  const statsBefore = statsCalls();
  await act(async () => right().click());
  expect(listCalls()).toBe(before);
  expect(statsCalls()).toBe(statsBefore + 1);
  expect(right().getAttribute("aria-label")).toBe("Retry project stats");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-knob="View mode"]')!.click());
  expect(right().getAttribute("aria-label")).toBe("Open selected project");
});
