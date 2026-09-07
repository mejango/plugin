// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoalEditor } from "@/components/create/GoalEditor";
import { uploadGoalImage } from "@/lib/upload-goal-image";

vi.mock("@/lib/upload-goal-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/upload-goal-image")>(),
  uploadGoalImage: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
const uploading = vi.fn();
function Editor() {
  const [value, onChange] = useState("My goal");
  return createElement(GoalEditor, { value, onChange, onUploadingChange: uploading });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Editor)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens the file picker from Media", async () => {
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const click = vi.spyOn(picker, "click").mockImplementation(() => {});
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Add media from your device"]')!.click());
  expect(click).toHaveBeenCalledOnce();
});

it("uploads a pasted image and inserts valid Markdown at the cursor", async () => {
  vi.mocked(uploadGoalImage).mockResolvedValue("https://juicebox.center/ipfs/example");
  const field = container.querySelector("textarea")!;
  field.setSelectionRange(3, 7);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [new File(["image"], "goal.png", { type: "image/png" })] } });
  await act(async () => { field.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(field.value).toBe("My ![goal.png](https://juicebox.center/ipfs/example)");
  expect(uploading.mock.calls).toEqual([[true], [false]]);
  expect(document.activeElement).toBe(field);
});

it("leaves text paste to the browser", async () => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [] } });
  await act(async () => { container.querySelector("textarea")!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(uploadGoalImage).not.toHaveBeenCalled();
});
