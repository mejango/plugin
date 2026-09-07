import { describe, expect, it } from "vitest";
import { formatMarkdown } from "@/lib/markdown-edit";

describe("Goal Markdown formatting", () => {
  it("wraps selected text without changing surrounding content", () => {
    expect(formatMarkdown("Make things happen", 5, 11, "bold"))
      .toEqual({ value: "Make **things** happen", start: 7, end: 13 });
  });

  it("inserts and selects a placeholder at the cursor", () => {
    expect(formatMarkdown("Goal: ", 6, 6, "italic"))
      .toEqual({ value: "Goal: *text*", start: 7, end: 11 });
  });

  it("selects the URL so a link can be completed immediately", () => {
    const edit = formatMarkdown("Read docs", 5, 9, "link");
    expect(edit.value).toBe("Read [docs](https://example.com)");
    expect(edit.value.slice(edit.start, edit.end)).toBe("https://example.com");
  });

  it("numbers whole selected lines without including the following line", () => {
    const value = "Intro\nFirst\nSecond\nOutro";
    const edit = formatMarkdown(value, 8, 19, "number");
    expect(edit.value).toBe("Intro\n1. First\n2. Second\nOutro");
  });

  it("adds a heading at the start of an empty first line", () => {
    expect(formatMarkdown("\nExisting", 0, 0, "heading").value).toBe("## Heading\nExisting");
  });

  it("formats the current line when there is no selection", () => {
    expect(formatMarkdown("Intro\nGoal", 8, 8, "quote").value).toBe("Intro\n> Goal");
  });
});
