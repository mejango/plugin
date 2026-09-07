import { afterEach, describe, expect, it, vi } from "vitest";
import { imageMarkdown, uploadGoalImage } from "@/lib/upload-goal-image";

afterEach(() => vi.unstubAllGlobals());

describe("Goal image upload", () => {
  it("uploads the file to Juicebox Center and uses its gateway", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cid: "QmExample", status: "queued" }), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["image"], "goal.png", { type: "image/png" });
    expect(await uploadGoalImage(file)).toBe("https://juicebox.center/ipfs/QmExample");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://juicebox.center/v1/pins/file");
    expect(options.method).toBe("POST");
    expect(options.body.get("file")).toBe(file);
  });

  it("rejects unsupported files before uploading", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadGoalImage(new File(["text"], "notes.txt", { type: "text/plain" }))).rejects.toThrow("Choose a PNG");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports failed uploads and invalid responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cid: "../bad" })));
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["image"], "goal.png", { type: "image/png" });
    await expect(uploadGoalImage(file)).rejects.toThrow("Image upload failed");
    await expect(uploadGoalImage(file)).rejects.toThrow("did not return an image link");
  });

  it("keeps filename brackets from breaking the Markdown", () => {
    expect(imageMarkdown("goal[1].png", "https://juicebox.center/ipfs/example"))
      .toBe("![goal 1 .png](https://juicebox.center/ipfs/example)");
  });
});
