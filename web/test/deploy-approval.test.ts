// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeployApproval } from "@/components/create/DeployApproval";
import type { DeploymentApproval } from "@/hooks/useDeployMachine";

let root: Root;
let container: HTMLDivElement;
const answer = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  answer.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function button(text: string) {
  const result = [...container.querySelectorAll("button")].find(element => element.textContent === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function render(approval: DeploymentApproval) {
  await act(async () => root.render(createElement(DeployApproval, { key: approval.id, approval, onAnswer: answer })));
}

describe("deployment quote and payment review", () => {
  it("requires an explicit quoted choice even for one option, using the existing select style", async () => {
    await render({ id: 1, kind: "funding", options: [{ chainId: 84532, label: "Base Sepolia — 0.0004 ETH" }] });
    const select = container.querySelector("select")!;
    expect(select.value).toBe("");
    expect(select.classList.contains("select")).toBe(true);
    expect(select.textContent).toContain("Base Sepolia — 0.0004 ETH");
    expect(button("Continue").disabled).toBe(true);
    expect(answer).not.toHaveBeenCalled();
    await act(async () => {
      select.value = "84532";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Continue").click());
    expect(answer).toHaveBeenCalledExactlyOnceWith(1, 84532);
  });

  it("does not show a funding selector during authorization review", async () => {
    await render({ id: 2, kind: "review", request: { kind: "authorization", calls: [{
      chainId: 10, to: "0x1111111111111111111111111111111111111111", data: "0x1234", value: "100000000000000", label: "Deploy machine",
    }] } });
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toContain("Choose a Relayr payment after the quote arrives");
    await act(async () => button("Cancel").click());
    expect(answer).toHaveBeenCalledExactlyOnceWith(2, null);
  });

  it("shows the exact payment amount and calldata before approving the wallet transaction", async () => {
    await render({ id: 3, kind: "review", request: { kind: "payment", calls: [{
      chainId: 8453, to: "0x1111111111111111111111111111111111111111", data: "0x1234", value: "123456789012345", label: "Pay Relayr",
    }] } });
    expect(container.textContent).toContain("0.000123456789012345 ETH");
    expect(container.textContent).toContain("0x1234");
    expect(container.querySelector("select")).toBeNull();
    expect(answer).not.toHaveBeenCalled();
    await act(async () => button("Confirm payment").click());
    expect(answer).toHaveBeenCalledExactlyOnceWith(3, true);
  });

  it("resets the selection for a new quote and lets Escape cancel it", async () => {
    await render({ id: 4, kind: "funding", options: [{ chainId: 1, label: "Ethereum — 0.001 ETH" }] });
    await act(async () => {
      const select = container.querySelector("select")!;
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await render({ id: 5, kind: "funding", options: [{ chainId: 1, label: "Ethereum — 0.002 ETH" }] });
    expect(container.querySelector("select")!.value).toBe("");
    expect(button("Continue").disabled).toBe(true);
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(answer).toHaveBeenCalledExactlyOnceWith(5, null);
  });
});
