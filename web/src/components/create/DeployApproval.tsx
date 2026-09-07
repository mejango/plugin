"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatEther } from "viem";
import type { DeploymentApproval } from "@/hooks/useDeployMachine";
import { CHAIN_LABELS } from "@/lib/chains";
import { SELECT } from "./ui";

/** Native top-layer dialog stays usable when deployment starts inside the workstation. */
export function DeployApproval({ approval, onAnswer }: {
  approval: DeploymentApproval;
  onAnswer: (id: number, value: number | boolean | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectId = useId();
  const [selected, setSelected] = useState("");
  const funding = approval.kind === "funding";
  const selectedOption = funding ? approval.options.find(option => String(option.chainId) === selected) : undefined;
  const title = funding ? "Choose where to pay" : approval.request.kind === "payment"
    ? "Review the Relayr payment" : "Review deployment";

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto border-2 border-black bg-white p-5 text-black backdrop:bg-black/50"
      onCancel={event => { event.preventDefault(); onAnswer(approval.id, null); }}>
      <h2 id={titleId} className="display mb-4 text-2xl">{title}</h2>
      {funding ? <>
        <p className="mb-5 text-sm">Relayr returned these payment options. One payment covers the quoted destination gas and creation fees.</p>
        <label htmlFor={selectId} className="display mb-2 block">Funding chain</label>
        <select id={selectId} className={SELECT} value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="" disabled>Choose a quoted option</option>
          {approval.options.map(option => <option key={option.chainId} value={option.chainId}>{option.label}</option>)}
        </select>
      </> : <>
        <p className="mb-4 text-sm">{approval.request.kind === "authorization"
          ? "Authorize the deployment on these chains. Choose a Relayr payment after the quote arrives."
          : approval.request.kind === "payment" ? "Review this exact payment before your wallet sends it."
            : "Your wallet will submit this deployment directly."}</p>
        <ul className="grid list-none gap-4 p-0">
          {approval.request.calls.map((call, index) => <li key={`${call.chainId}-${index}`} className="min-w-0 border border-black p-3">
            <p className="display">{call.label} · {CHAIN_LABELS[call.chainId] ?? call.chainId}</p>
            <p className="my-2 text-sm">{formatEther(BigInt(call.value))} ETH</p>
            <details className="text-xs">
              <summary className="cursor-pointer">Transaction details</summary>
              <p className="mt-2 break-all">Contract: {call.to}</p>
              <p className="mt-2 max-h-40 overflow-auto break-all font-mono">Data: {call.data}</p>
            </details>
          </li>)}
        </ul>
        {approval.request.authorization && <details className="mt-4 text-xs">
          <summary className="cursor-pointer">Signature details</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(approval.request.authorization, null, 2)}</pre>
        </details>}
      </>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="min-h-11 cursor-pointer border-2 border-black px-4" onClick={() => onAnswer(approval.id, null)}>Cancel</button>
        <button type="button" disabled={funding && !selectedOption}
          className="min-h-11 cursor-pointer border-2 border-black bg-black px-4 text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onAnswer(approval.id, funding ? selectedOption?.chainId ?? null : true)}>
          {funding ? "Continue" : approval.request.kind === "payment" ? "Confirm payment" : "Continue to wallet"}
        </button>
      </div>
    </dialog>
  );
}
