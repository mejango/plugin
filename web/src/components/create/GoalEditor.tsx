"use client";

import { useLayoutEffect, useRef } from "react";

import { FIELD } from "@/components/create/ui";
import { formatMarkdown, type MarkdownAction } from "@/lib/markdown-edit";

const ACTIONS: { action: MarkdownAction; label: string; text: string }[] = [
  { action: "bold", label: "Bold", text: "B" },
  { action: "italic", label: "Italic", text: "I" },
  { action: "heading", label: "Heading", text: "H" },
  { action: "link", label: "Link", text: "Link" },
  { action: "media", label: "Add media (image URL)", text: "Media" },
  { action: "bullet", label: "Bulleted list", text: "• List" },
  { action: "number", label: "Numbered list", text: "1. List" },
  { action: "quote", label: "Quote", text: "Quote" },
  { action: "code", label: "Inline code", text: "</>" },
];

export function GoalEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    if (!selection.current || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(...selection.current);
    selection.current = null;
  }, [value]);

  function format(action: MarkdownAction) {
    const field = input.current;
    if (!field) return;
    const edit = formatMarkdown(value, field.selectionStart, field.selectionEnd, action);
    selection.current = [edit.start, edit.end];
    onChange(edit.value);
  }

  return (
    <div className="min-w-0">
      <div role="group" aria-label="Goal Markdown formatting" className="flex flex-wrap gap-1 border-2 border-b-0 border-black bg-white px-2 py-1">
        {ACTIONS.map(({ action, label, text }) => (
          <button
            key={action}
            type="button"
            aria-label={label}
            title={label}
            aria-controls="goal"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(action)}
            className={`min-h-9 min-w-9 cursor-pointer px-2 text-[.8rem] text-[#555] hover:bg-[#f4f4f4] hover:text-black focus-visible:outline-2 focus-visible:outline-black ${action === "bold" ? "font-bold" : action === "italic" ? "italic" : ""}`}
          >
            {text}
          </button>
        ))}
      </div>
      <textarea
        ref={input}
        id="goal"
        required
        className={`${FIELD} block min-h-[10rem] resize-y`}
        placeholder="What's your machine's goal? Why should it be funded?"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
