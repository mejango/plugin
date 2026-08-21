"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { DoublingChart } from "@/components/create/DoublingChart";
import { HouseRules } from "@/components/create/HouseRules";
import { IssuancePie } from "@/components/create/IssuancePie";
import { MachineManual } from "@/components/create/MachineManual";
import { OperatorTooltip } from "@/components/create/OperatorTooltip";
import { RoutesPanel } from "@/components/create/RoutesPanel";
import { FIELD, HINT, LABEL, READOUT, SELECT } from "@/components/create/ui";
import { SignIn } from "@/components/SignIn";
import { useDeployMachine } from "@/hooks/useDeployMachine";
import { CHAIN_LABELS, SUPPORTED_CHAIN_IDS } from "@/lib/chains";
import { REV_MACHINE } from "@/lib/machines";
import { DOUBLINGS, KEEPS, DEFAULT_DOUBLING, DEFAULT_KEEP_PERCENT, tokensPerDollarAt, doublingFor } from "@/lib/telligence/house";
import { buildManual } from "@/lib/telligence/manual";
import type { MachineDraft, Route } from "@/lib/telligence/types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function CreateForm() {
  // Every machine ships routed into REV by default — the network is the point.
  const [draft, setDraft] = useState<MachineDraft>({
    name: "",
    id: "",
    goal: "",
    address: "",
    keepPercent: DEFAULT_KEEP_PERCENT,
    doubling: DEFAULT_DOUBLING,
    routes: [{ machine: REV_MACHINE, percent: 10, locked: false }],
    chainIds: [...SUPPORTED_CHAIN_IDS],
  });
  const [manualEdit, setManualEdit] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const { isConnected } = useAccount();
  const { deploy, steps, busy, error } = useDeployMachine();

  const set = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const generatedManual = useMemo(() => buildManual(draft), [draft]);
  const tokenWord = draft.id.trim() ? draft.id.trim().toUpperCase() : "tokens";
  const hoverTokens = hoverDay === null ? null : tokensPerDollarAt(draft.doubling, hoverDay);
  const addressValid = ADDRESS_RE.test(draft.address.trim());

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void deploy(draft, manualEdit ?? generatedManual);
  }

  return (
    <form onSubmit={submit} className="mt-[5vh] grid gap-[2.2rem]">
      <div className="grid gap-2">
        <label htmlFor="name" className={LABEL}>Machine&apos;s name</label>
        <input
          id="name" required maxLength={50} className={FIELD}
          placeholder="e.g. Foraging Bot"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-[1.4rem] min-[621px]:grid-cols-[1fr_2.4fr]">
        <div className="grid content-start gap-2">
          <label htmlFor="symbol" className={LABEL}>Machine&apos;s ID</label>
          <input
            id="symbol" required maxLength={10}
            className={`${FIELD} uppercase tracking-[.05em]`}
            placeholder="FORAGE"
            value={draft.id}
            onChange={(e) => set("id", e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
          />
        </div>
        <div className="grid content-start gap-2">
          <label htmlFor="machine-address" className={LABEL}>
            Machine&apos;s address <span className={HINT}><OperatorTooltip /></span>
          </label>
          <input
            id="machine-address" required spellCheck={false} autoComplete="off"
            className={`${FIELD} font-mono tracking-[.02em]`}
            placeholder="0x…"
            value={draft.address}
            onChange={(e) => set("address", e.target.value)}
            aria-invalid={draft.address.length > 0 && !addressValid}
          />
          {draft.address.length > 0 && !addressValid && (
            <span className="text-[.72rem] text-[#aaa]">That isn&apos;t a 20-byte address yet.</span>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <label htmlFor="goal" className={LABEL}>
          Goal <span className={HINT}>markdown supported</span>
        </label>
        <textarea
          id="goal" required
          className={`${FIELD} min-h-[10rem] resize-y`}
          placeholder="What's your machine's goal? Why should it be funded?"
          value={draft.goal}
          onChange={(e) => set("goal", e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <label className={LABEL}>
          Issuance price doublings <span className={HINT}>the pace of changes favoring earlier contributions</span>
        </label>
        <div className="grid grid-cols-1 items-stretch gap-[1.4rem] min-[621px]:grid-cols-[1fr_2fr]">
          <div className="grid auto-rows-fr border-2 border-black">
            {DOUBLINGS.map((option, i) => (
              <button
                key={option.key} type="button"
                onClick={() => set("doubling", option.key)}
                aria-pressed={draft.doubling === option.key}
                className={`display cursor-pointer px-[.4rem] py-[.85rem] text-[1.05rem] leading-tight tracking-[.02em] ${i > 0 ? "border-t-2 border-black" : ""} ${
                  draft.doubling === option.key ? "bg-black text-white" : "bg-white text-black hover:bg-[#f0f0f0]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={`${READOUT} flex flex-col px-[.7rem] pb-[.7rem] pt-[1.7rem]`}>
            <DoublingChart selected={draft.doubling} tokenWord={tokenWord} onHoverDay={setHoverDay} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[1.4rem] min-[621px]:grid-cols-2">
        <div className="grid content-start gap-2">
          <label htmlFor="cut" className={LABEL}>
            Machine&apos;s keep <span className={HINT}>its cut of issuance</span>
          </label>
          <select
            id="cut" className={SELECT}
            value={draft.keepPercent}
            onChange={(e) => set("keepPercent", Number(e.target.value))}
          >
            {KEEPS.map((keep) => (
              <option key={keep.percent} value={keep.percent}>{keep.label}</option>
            ))}
          </select>
          <p className="m-0 mt-[.1rem] text-[.72rem] text-[#aaa]">
            The rest ({100 - draft.keepPercent}%) goes to the payer who is issuing the tokens.
          </p>

          <label className={`${LABEL} mt-[1.4rem]`}>
            Plug ins <span className={HINT}>the split of keep to other machines</span>
          </label>
          <RoutesPanel
            routes={draft.routes}
            keepPercent={draft.keepPercent}
            onChange={(routes: Route[]) => set("routes", routes)}
          />
        </div>
        <div className={`${READOUT} grid content-start gap-[.8rem] px-4 pb-4 pt-[1.7rem]`}>
          <IssuancePie
            keepPercent={draft.keepPercent}
            routes={draft.routes.map((r) => ({ name: r.machine.name, percentOfKeep: r.percent }))}
            tokenWord={tokenWord}
            hoverTokensPerDollar={hoverTokens}
          />
        </div>
      </div>

      <HouseRules />

      <MachineManual
        generated={generatedManual}
        value={manualEdit ?? generatedManual}
        dirty={manualEdit !== null}
        onChange={setManualEdit}
        onReset={() => setManualEdit(null)}
      />

      <div className="flex flex-col items-stretch gap-[.7rem] min-[621px]:items-end">
        <div className="grid w-full gap-2">
          <label className={LABEL}>
            Chains <span className={HINT}>a machine lives everywhere at once — one signature per chain</span>
          </label>
          <div className="flex flex-wrap gap-[1.2rem]">
            {SUPPORTED_CHAIN_IDS.map((chainId) => (
              <label key={chainId} className="inline-flex cursor-pointer items-center gap-[.4rem] text-[.9rem]">
                <input
                  type="checkbox" className="m-0 accent-black"
                  checked={draft.chainIds.includes(chainId)}
                  onChange={(e) =>
                    set(
                      "chainIds",
                      e.target.checked
                        ? [...draft.chainIds, chainId].sort((a, b) => SUPPORTED_CHAIN_IDS.indexOf(a) - SUPPORTED_CHAIN_IDS.indexOf(b))
                        : draft.chainIds.filter((id) => id !== chainId),
                    )
                  }
                />
                {CHAIN_LABELS[chainId]}
              </label>
            ))}
          </div>
        </div>

        {!isConnected ? (
          <SignIn />
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="display w-full cursor-pointer border-2 border-black bg-black px-[1.7em] py-[.75em] text-[clamp(1.1rem,2.4vw,1.5rem)] tracking-[.03em] text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-40 min-[621px]:w-auto"
          >
            {busy ? "Deploying…" : "Deploy"}
          </button>
        )}

        <span className="text-center text-[.85rem] text-[#555] min-[621px]:text-right">
          {error ? error : `You'll confirm once per chain — ${doublingFor(draft.doubling).label.toLowerCase()} doublings, ${draft.keepPercent}% keep.`}
        </span>

        {steps.length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0 text-[.8rem] text-[#555]">
            {steps.map((step) => (
              <li key={step.chainId}>
                {step.label}: {step.status}
                {step.hash ? ` ${step.hash.slice(0, 10)}…` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
