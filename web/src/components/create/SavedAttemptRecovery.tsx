"use client";

import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { SAVED_ATTEMPT_TAB_ONLY_LINE, type SavedAttempt, type WriteHoldClient } from "@bananapus/nana-sdk-core/review";
import { useHeldWrite, useSavedAttempt } from "@bananapus/nana-sdk-core/review/react";
import { LINK_BTN } from "@/components/create/ui";
import { WriteHeldNotice } from "@/components/create/WriteHeldNotice";
import { savedAttempts, withUnreadableConsent, writeHolds } from "@/lib/plugin/write-holds";

/**
 * A saved attempt (a Relayr deploy payment), recovered through the SDK
 * (useSavedAttempt): the hold's line and exit while it is held, or its one
 * check action (and, only after storage proved unreadable, the warned exit).
 * It decides nothing: a retirement goes to `onRetired`, and an attempt that
 * settled, or has nothing left to recover, goes to `onFollow`.
 */
export default function SavedAttemptRecovery({ attempt, checkNext, onRetired, onFollow }: {
  attempt: SavedAttempt<unknown>;
  /** The check action's next step, as checkedItLabel words it. */
  checkNext: string;
  /** The SDK retired the attempt: by the user's exit or check, or warned over unreadable storage. */
  onRetired: (how: { by: "exit" | "check" | "unreadable" }) => void;
  /** Recovery found it done (the flow resumes and follows it), or nothing left to recover (`none`). */
  onFollow: (status: "done" | "none") => void;
}) {
  const client = usePublicClient({ chainId: attempt.chainId }) as unknown as WriteHoldClient;
  const saved = useSavedAttempt({ recovery: savedAttempts, attempt, client, checkNext });
  const [tabOnly, setTabOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const held = useHeldWrite({
    hold: writeHolds,
    chainId: attempt.chainId,
    account: attempt.account,
    safe: attempt.safe,
    namespace: attempt.namespaces[0],
    ...(attempt.namespaces.length > 1 ? { legacy: attempt.namespaces.slice(1) } : {}),
    client,
    // It settled while shown (during the exit included): recovery reads it again, and a success is followed.
    onSettled: () => void saved.recover(),
    // The user's exit released it: the SDK records that exit, then the flow reopens.
    onReleased: by => {
      if (by !== "user") return void saved.recover();
      void saved.retire({ by: "exit" }).then(retired => {
        if (retired.retired) onRetired({ by: "exit" });
        else void saved.recover();
      });
    },
  });
  const status = saved.outcome?.status;
  const followed = useRef(false);
  useEffect(() => {
    if (followed.current || (status !== "done" && status !== "none")) return;
    followed.current = true;
    onFollow(status);
  }, [status, onFollow]);

  const run = (action: () => Promise<{ retired: boolean; durable?: boolean } | unknown>, by: "check" | "unreadable") => {
    setBusy(true);
    void action().then(result => {
      const retired = result as { retired?: boolean; durable?: boolean } | null;
      if (!retired?.retired) return;
      setTabOnly(retired.durable === false);
      onRetired({ by });
    }, () => undefined).finally(() => setBusy(false));
  };

  if (status === "held") {
    return <WriteHeldNotice chainId={attempt.chainId} view={held.state ? held : { ...held, line: saved.outcome!.status === "held" ? saved.outcome!.state.line : null }} action={held.exitAction} />;
  }
  if (saved.checkAction) {
    const { checkAction, unreadableAction } = saved;
    return (
      <span className="block space-y-2 text-sm text-[#555]">
        <span className="block">{checkAction.line}</span>
        <span className="block text-xs">{checkAction.warning}</span>
        <button type="button" disabled={busy} className={LINK_BTN} onClick={() => run(checkAction.run, "check")}>{checkAction.label}</button>
        {unreadableAction ? (
          <>
            <span className="block">{unreadableAction.line}</span>
            <button type="button" disabled={busy} className={LINK_BTN} onClick={() => run(() => withUnreadableConsent(attempt, unreadableAction.run), "unreadable")}>
              {unreadableAction.label}
            </button>
          </>
        ) : null}
      </span>
    );
  }
  return tabOnly ? <span className="block text-sm">{SAVED_ATTEMPT_TAB_ONLY_LINE}</span> : null;
}
