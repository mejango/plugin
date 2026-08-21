"use client";

import { useEffect, useRef, useState } from "react";

import { LABEL, HINT, LINK_BTN, FIELD } from "@/components/create/ui";

/**
 * The manual tracks the form until the user edits it by hand; from then on their
 * text wins and a reset link appears. Losing someone's writing to a re-render
 * would be unforgivable, so `dirty` is sticky.
 */
export function MachineManual({
  generated,
  value,
  dirty,
  onChange,
  onReset,
}: {
  generated: string;
  value: string;
  dirty: boolean;
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(dirty ? value : generated);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="grid gap-2">
      <label htmlFor="manual" className={LABEL}>
        Machine&apos;s manual
        <span className={HINT}>paste this into your machine — it fills itself in as you configure</span>
      </label>
      <textarea
        id="manual"
        spellCheck={false}
        value={dirty ? value : generated}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} min-h-[22rem] resize-y font-mono text-[.78rem] leading-[1.55]`}
      />
      <div className="flex justify-end gap-4">
        {dirty && (
          <button type="button" onClick={onReset} className={LINK_BTN}>
            reset edits
          </button>
        )}
        <button type="button" onClick={() => void copy()} className={LINK_BTN}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}
