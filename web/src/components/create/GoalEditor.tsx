"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { FIELD } from "@/components/create/ui";
import { formatMarkdown, type MarkdownAction } from "@/lib/markdown-edit";

import { GOAL_IMAGE_TYPES, imageMarkdown, uploadGoalImage } from "@/lib/upload-goal-image";

const ACTIONS: { action: MarkdownAction; label: string; text: string }[] = [
  { action: "bold", label: "Bold", text: "B" },
  { action: "italic", label: "Italic", text: "I" },
  { action: "heading", label: "Heading", text: "H" },
  { action: "link", label: "Link", text: "Link" },
  { action: "media", label: "Add media from your device", text: "Media" },
  { action: "bullet", label: "Bulleted list", text: "• List" },
  { action: "number", label: "Numbered list", text: "1. List" },
  { action: "quote", label: "Quote", text: "Quote" },
  { action: "code", label: "Inline code", text: "</>" },
];

export function GoalEditor({ value, onChange, onUploadingChange }: {
  value: string;
  onChange: (value: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    if (!selection.current || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(...selection.current);
    selection.current = null;
  }, [value]);

  async function addImages(files: File[]) {
    const field = input.current;
    if (!field || !files.length || uploadingRef.current) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    uploadingRef.current = true;
    setUploading(true);
    onUploadingChange(true);
    setError(null);
    try {
      const images = [];
      for (const file of files) images.push(imageMarkdown(file.name, await uploadGoalImage(file)));
      const markdown = images.join("\n");
      selection.current = [start + markdown.length, start + markdown.length];
      onChange(value.slice(0, start) + markdown + value.slice(end));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed. Please try again.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      onUploadingChange(false);
    }
  }

  function format(action: MarkdownAction) {
    if (uploadingRef.current) return;
    if (action === "media") {
      picker.current?.click();
      return;
    }
    const field = input.current;
    if (!field) return;
    const edit = formatMarkdown(value, field.selectionStart, field.selectionEnd, action);
    selection.current = [edit.start, edit.end];
    onChange(edit.value);
  }

  return (
    <div className="min-w-0">
      <input
        ref={picker}
        type="file"
        accept={GOAL_IMAGE_TYPES}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addImages(files);
        }}
      />
      <div role="group" aria-label="Goal Markdown formatting" className="flex flex-wrap gap-1 border-2 border-b-0 border-black bg-white px-2 py-1">
        {ACTIONS.map(({ action, label, text }) => (
          <button
            key={action}
            type="button"
            disabled={uploading}
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
        readOnly={uploading}
        aria-busy={uploading}
        className={`${FIELD} block min-h-[10rem] resize-y`}
        placeholder="What's your machine's goal? Why should it be funded?"
        value={value}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (!files.length) return;
          event.preventDefault();
          void addImages(files);
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {uploading && <p role="status" className="mt-2 text-[.75rem] text-[#555]">Uploading image…</p>}
      {error && <p role="alert" className="mt-2 text-[.75rem] text-red-700">{error}</p>}
    </div>
  );
}
