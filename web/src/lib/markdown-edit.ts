export type MarkdownAction = "bold" | "italic" | "heading" | "link" | "bullet" | "number" | "quote" | "code" | "media";

/** Return the edited Markdown and the text to select when focus returns. */
export function formatMarkdown(value: string, start: number, end: number, action: MarkdownAction) {
  if (action === "heading" || action === "bullet" || action === "number" || action === "quote") {
    const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    // A selection ending at the next line's start does not include that line.
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextNewline = value.indexOf("\n", last);
    const lineEnd = nextNewline < 0 ? value.length : nextNewline;
    const content = value.slice(lineStart, lineEnd) || (action === "heading" ? "Heading" : action === "quote" ? "Quote" : "List item");
    const formatted = content.split("\n").map((line, index) => {
      const prefix = action === "heading" ? "## " : action === "bullet" ? "- " : action === "quote" ? "> " : `${index + 1}. `;
      return prefix + line;
    }).join("\n");
    return { value: value.slice(0, lineStart) + formatted + value.slice(lineEnd), start: lineStart, end: lineStart + formatted.length };
  }

  const hasUrl = action === "link" || action === "media";
  const url = action === "media" ? "https://example.com/image.png" : "https://example.com";
  const text = value.slice(start, end) || (action === "media" ? "Image description" : action === "link" ? "Link text" : action === "code" ? "code" : "text");
  const marker = action === "bold" ? "**" : action === "italic" ? "*" : action === "code" ? "`" : action === "media" ? "![" : "[";
  const suffix = hasUrl ? `](${url})` : marker;
  const formatted = marker + text + suffix;
  const selectionStart = hasUrl ? start + marker.length + text.length + 2 : start + marker.length;
  return {
    value: value.slice(0, start) + formatted + value.slice(end),
    start: selectionStart,
    end: selectionStart + (hasUrl ? url.length : text.length),
  };
}
