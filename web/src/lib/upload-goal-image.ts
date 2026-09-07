export const GOAL_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif";

export async function uploadGoalImage(file: File): Promise<string> {
  if (!GOAL_IMAGE_TYPES.split(",").includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, GIF, WebP, or AVIF image.");
  }
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image smaller than 25 MB.");
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("https://juicebox.center/v1/pins/file", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("Image upload failed. Please try again.");
  const data: { cid?: unknown } = await response.json();
  if (typeof data.cid !== "string" || !/^[a-zA-Z0-9]+$/.test(data.cid)) {
    throw new Error("The upload did not return an image link. Please try again.");
  }
  return `https://juicebox.center/ipfs/${data.cid}`;
}

export function imageMarkdown(fileName: string, url: string): string {
  const description = fileName.replace(/[\[\]\\\r\n]/g, " ").trim() || "Image";
  return `![${description}](${url})`;
}
