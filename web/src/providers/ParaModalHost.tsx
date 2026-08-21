"use client";

import { ParaProvider } from "@getpara/react-sdk-lite";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import ParaAuthSheet from "./ParaAuthSheet";
import { PARA_APP, getParaClient } from "./para-config";

/** Layout effects run before paint, which is the whole point here; on the
 *  server there is no paint and React warns, so fall back there. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Hosts the sign-in sheet in the top layer.
 *
 * A `<dialog>` opened with `showModal()` inerts everything outside itself, and
 * sign-in has to work from inside other dialogs, so the sheet needs to be in
 * the top layer too. The host is also mounted ahead of a request to warm Para
 * up, which is why `open` gates what is rendered rather than whether this
 * exists.
 *
 * Loaded only once a visitor asks to sign in, or warmed on pointer intent.
 */
export default function ParaModalHost({
  open,
  onClose,
  onSettled,
  entry,
  onEntryChange,
}: {
  open: boolean;
  /** Must be referentially stable: it gates a subscription to Para's stream. */
  onClose: () => void;
  onSettled: () => void;
  entry: string;
  onEntryChange: (value: string) => void;
}) {
  const para = getParaClient();
  // Built during render rather than in an effect. Creating it afterwards means
  // returning null for a render first — and since the placeholder has already
  // unmounted by then, that null is a frame of empty screen between the two.
  const [host] = useState<HTMLDialogElement | null>(() => {
    if (typeof document === "undefined") return null;
    const dialog = document.createElement("dialog");
    dialog.className = "ui-modal-host";
    return dialog;
  });

  useBeforePaint(() => {
    if (!host) return;
    // Escape belongs to the sheet, which refuses it mid-flight. Closing the
    // host natively would strand Para's poll.
    const preventNativeCancel = (event: Event) => event.preventDefault();
    host.addEventListener("cancel", preventNativeCancel);
    document.body.appendChild(host);
    return () => {
      host.removeEventListener("cancel", preventNativeCancel);
      host.remove();
    };
  }, [host]);

  // Deliberately a passive effect, not a layout one: sign-in is reachable from
  // inside other dialogs, and this has to enter the top layer after theirs to
  // sit above them. Opening before paint would put it under.
  useEffect(() => {
    if (!host) return;
    if (open && !host.open) host.showModal();
    else if (!open && host.open) host.close();
  }, [host, open]);

  if (!host) return null;

  return createPortal(
    <ParaProvider paraClientConfig={para} config={{ appName: PARA_APP.appName }}>
      {open ? (
        <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-black/70 p-6">
          <div className="w-full max-w-sm border-2 border-black bg-white p-6">
            <ParaAuthSheet
              onClose={() => {
                onClose();
                onSettled();
              }}
              entry={entry}
              onEntryChange={onEntryChange}
            />
          </div>
        </div>
      ) : null}
    </ParaProvider>,
    host,
  );
}
