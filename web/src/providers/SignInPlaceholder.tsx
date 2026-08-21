"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Before paint, so the click is acknowledged in the frame it happened in. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Painted the instant sign-in is asked for, while Para's runtime downloads.
 *
 * That runtime is ~725 KiB gzipped and is deliberately not shipped to
 * anonymous visitors, so a cold click has to fetch it — several seconds on a
 * slow link. Rendering nothing until it lands makes the button feel broken, so
 * this stands in: the real sheet's opening, inert, in the same frame, so the
 * swap reads as filling in rather than as a jump.
 */
export function SignInPlaceholder({
  entry,
  onEntryChange,
}: {
  entry: string;
  onEntryChange: (value: string) => void;
}) {
  const [host] = useState<HTMLDialogElement | null>(() => {
    if (typeof document === "undefined") return null;
    const dialog = document.createElement("dialog");
    dialog.className = "ui-modal-host";
    return dialog;
  });

  useBeforePaint(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);

  useEffect(() => {
    if (host && !host.open) host.showModal();
  }, [host]);

  if (!host) return null;

  return createPortal(
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-black/70 p-6">
      <div className="w-full max-w-sm border-2 border-black bg-white p-6">
        <h2 className="display text-[1.6rem]">Sign in</h2>
        <p className="mt-1 text-[.85rem] text-[#555]">You will receive a code.</p>
        <input
          type="text"
          value={entry}
          onChange={(event) => onEntryChange(event.target.value)}
          placeholder="you@email.com | +1 222 333 4444"
          aria-label="Email address or phone number"
          autoComplete="email"
          autoFocus
          className="mt-5 w-full appearance-none rounded-none border-2 border-black bg-white px-[.9rem] py-[.7rem] text-inherit placeholder:text-[#888] focus:outline-3 focus:outline-black focus:outline-offset-2"
        />
        <div className="mt-3 flex justify-end">
          <div className="display border-2 border-[#ccc] bg-[#eee] px-[1.2em] py-[.45em] text-[1.05rem] tracking-[.03em] text-[#999]">
            Continue
          </div>
        </div>
        {/* Labels and reserved rows, but no provider marks: this component is
            eager, and the marks would ride along on every page load for a panel
            most visitors never open. The sheet renders them a moment later,
            from Para's own chunk. */}
        {["Or, use socials", "… or, a wallet."].map((label) => (
          <div key={label}>
            <p className="mb-2 mt-5 text-[.7rem] uppercase tracking-[.18em] text-[#777]">{label}</p>
            <div className="min-h-11" />
          </div>
        ))}
      </div>
    </div>,
    host,
  );
}
