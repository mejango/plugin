"use client";

import { useConfig } from "wagmi";
import { writeExitMessage, type HeldWriteView } from "@bananapus/nana-sdk-core/review";
import { LINK_BTN } from "@/components/create/ui";

/**
 * A held write as the SDK's held-write view shows it: its one line, a link
 * when it has a hash, the view's notice and warning, and the action it offers.
 * Display only; inline elements, so it can sit in the deploy status line.
 */
export function WriteHeldNotice({ chainId, view, action }: {
  chainId: number;
  view: Pick<HeldWriteView, "line" | "warning" | "notice" | "state" | "exit">;
  action?: { label: string; run: () => unknown } | null;
}) {
  const explorer = useConfig().chains.find(chain => chain.id === chainId)?.blockExplorers?.default.url;
  const state = view.state;
  const hash = state && state.status !== "clear" ? ("hash" in state && state.hash ? state.hash : state.record.hash) : undefined;
  const url = hash && explorer ? `${explorer}/tx/${hash}` : null;
  // What sending again risks, beside the exit: the hold's warning, or the SDK's line for its call.
  const warning = view.warning ?? (view.exit && state && state.status !== "clear" ? writeExitMessage(state.record.call) : null);
  return (
    <span className="block space-y-2 text-sm text-[#555]">
      <span className="block">
        {view.line}
        {url ? <>{" "}<a href={url} target="_blank" rel="noopener noreferrer" className="underline">View transaction</a></> : null}
      </span>
      {view.notice ? <span className="block text-xs">{view.notice}</span> : null}
      {action ? (
        <>
          <button type="button" className={LINK_BTN} onClick={() => void action.run()}>{action.label}</button>
          {warning ? <span className="block text-xs">{warning}</span> : null}
        </>
      ) : null}
    </span>
  );
}
