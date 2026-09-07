"use client";

import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useAccount, useEnsName } from "wagmi";
import type { Hex } from "viem";

import { createIssues } from "@/lib/plugin/create-flow";
import styles from "./CreateConsole.module.css";

import { DoublingChart } from "@/components/create/DoublingChart";
import { GoalEditor } from "@/components/create/GoalEditor";
import { HouseRules } from "@/components/create/HouseRules";
import { IssuancePie } from "@/components/create/IssuancePie";
import { MachineManual } from "@/components/create/MachineManual";
import { OperatorTooltip } from "@/components/create/OperatorTooltip";
import { RoutesPanel } from "@/components/create/RoutesPanel";
import { FIELD, HINT, LABEL, READOUT, SELECT } from "@/components/create/ui";
import { SignIn } from "@/components/SignIn";
import { useDeployMachine } from "@/hooks/useDeployMachine";
import { CHAIN_LABELS, MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "@/lib/chains";
import { REV_MACHINE } from "@/lib/machines";
import { DOUBLINGS, KEEPS, DEFAULT_DOUBLING, DEFAULT_KEEP_PERCENT, tokensPerDollarAt, doublingFor } from "@/lib/plugin/house";
import { buildManual } from "@/lib/plugin/manual";
import type { MachineDraft, Route } from "@/lib/plugin/types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DeployApproval = lazy(() => import("./DeployApproval").then(module => ({ default: module.DeployApproval })));

export function CreateForm() {
  const [message, setMessage] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  // Every machine ships routed into REV by default — the network is the point.
  const [draftInput, setDraft] = useState<MachineDraft>({
    name: "",
    id: "",
    goal: "",
    address: "",
    keepPercent: DEFAULT_KEEP_PERCENT,
    doubling: DEFAULT_DOUBLING,
    routes: [{ machine: REV_MACHINE, percent: 10, locked: false }],
    chainIds: [...MAINNET_CHAIN_IDS],
  });
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [manualEdit, setManualEdit] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"mainnet" | "testnet">("mainnet");
  const [executionInputs, setExecutionInputs] = useState<Record<string, Record<number, string>>>({});
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: 1, query: { enabled: isConnected && !!address, staleTime: 300_000, retry: false } });
  const { deploy, session, steps, busy, restoring, storageBlocked, error, progress, canClear, clear, approval, answerApproval } = useDeployMachine();
  const draft = session?.draft ?? draftInput;
  const locked = busy || restoring || storageBlocked || Boolean(session);
  const testnet = session ? session.draft.chainIds.some(chainId => TESTNET_CHAIN_IDS.includes(chainId)) : environment === "testnet";
  const chainIds = testnet ? TESTNET_CHAIN_IDS : MAINNET_CHAIN_IDS;

  const set = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) => {
    if (locked) return;
    setMessage("");
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const generatedManual = useMemo(() => buildManual(draft), [draft]);
  const tokenWord = draft.id.trim() ? draft.id.trim().toUpperCase() : "tokens";
  const hoverTokens = hoverDay === null ? null : tokensPerDollarAt(draft.doubling, hoverDay);
  const addressValid = ADDRESS_RE.test(draft.address.trim());

  const issues = createIssues(draft);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (uploadingMedia || busy || restoring || storageBlocked) return;
    if (session) {
      const hashes = Object.entries(executionInputs[session.id] ?? {}).filter(([, value]) => value.trim());
      if (hashes.some(([, value]) => !/^0x[0-9a-fA-F]{64}$/.test(value.trim()))) {
        setMessage("Enter a complete executed transaction hash, or leave it blank to check the saved transaction.");
        return;
      }
      setMessage("");
      void deploy(undefined, undefined, Object.fromEntries(hashes.map(([chain, value]) => [chain, value.trim() as Hex])));
      return;
    }
    if (issues.length) { setMessage(issues[0].message); panel.current?.scrollTo({top: 0, behavior: "smooth"}); return; }
    void deploy(draft, manualEdit ?? generatedManual);
  }

  return (
    <div ref={panel} className={styles.fullForm}>
      <header className={styles.fullIntro}><h1 className="display">New plug in</h1><p>Give your machine a money engine so it can fundraise, process revenues, and manage incentives between machines.</p></header>
      <form onSubmit={submit} noValidate className={styles.form}>
        <div>
          <div className={styles.body}>
            {message && <p role="alert" className={styles.error}>{message}</p>}
            <fieldset disabled={locked} className="contents">
            <section className={styles.page} aria-label="Identity">
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
            id="machine-address" required pattern="0x[a-fA-F0-9]{40}" spellCheck={false} autoComplete="off"
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


            </section>
            <section className={styles.page} aria-label="Goal">
      <div className="grid gap-2">
        <label htmlFor="goal" className={LABEL}>
          Goal
        </label>
        <GoalEditor value={draft.goal} onChange={(value) => set("goal", value)} onUploadingChange={setUploadingMedia} />
      </div>


            </section>
            <section className={styles.page} aria-label="Issuance">
      <p className="m-0 text-[.75rem] leading-relaxed text-[#555]">
        Set operating rules below. For more control, use{" "}
        <a href="https://revnet.money" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black">revnet.money</a>
        {" "}or{" "}
        <a href="https://juicebox.money" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black">juicebox.money</a>.
      </p>

      <div className="grid gap-2">
        <label className={LABEL}>
          Pace of issuance price increase <span className={HINT}>How often the token gets twice as expensive and harder to access more of.</span>
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
          <div data-chart className={`${READOUT} flex flex-col px-[.7rem] pb-[.7rem] pt-[1.7rem]`}>
            <DoublingChart selected={draft.doubling} tokenWord={tokenWord} onHoverDay={setHoverDay} />
          </div>
        </div>
      </div>


            </section>
            <section className={styles.page} aria-label="Splits">
      <div className="grid grid-cols-1 gap-[1.4rem] min-[621px]:grid-cols-2">
        <div className="grid content-start gap-2">
          <label htmlFor="cut" className={LABEL}>
            Machine&apos;s keep <span className={HINT}>Its cut of issuance</span>
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
            Plug ins <span className={HINT}>The split of keep to other machines</span>
          </label>
          <RoutesPanel
            routes={draft.routes}
            keepPercent={draft.keepPercent}
            onChange={(routes: Route[]) => set("routes", routes)}
          />
        </div>
        <div data-chart className={`${READOUT} grid content-start gap-[.8rem] px-4 pb-4 pt-[1.7rem]`}>
          <IssuancePie
            keepPercent={draft.keepPercent}
            routes={draft.routes.map((r) => ({ name: r.machine.name, percentOfKeep: r.percent }))}
            tokenWord={tokenWord}
            hoverTokensPerDollar={hoverTokens}
          />
        </div>
      </div>


            </section>
            <section className={styles.page} aria-label="How it works">
      <HouseRules />


            </section>
            <section className={styles.page} aria-label="Manual">
      <MachineManual
        generated={generatedManual}
        value={session?.manual ?? manualEdit ?? generatedManual}
        dirty={Boolean(session) || manualEdit !== null}
        onChange={setManualEdit}
        onReset={() => setManualEdit(null)}
      />


            </section>
            </fieldset>
            <section className={styles.page} aria-label="Launch">
      <div className={styles.review}>
        <div><span>Machine</span><strong>{draft.name || "Untitled"} / {draft.id.toUpperCase() || "ID"}</strong></div>
        <div><span>Operator</span><strong className={styles.address}>{draft.address || "Not set"}</strong></div>
        <div><span>Issuance</span><strong>{doublingFor(draft.doubling).label} price increases</strong></div>
        <div><span>Keep / payer</span><strong>{draft.keepPercent}% / {100 - draft.keepPercent}%</strong></div>
        <div><span>Plug ins</span><strong>{draft.routes.length} machine{draft.routes.length === 1 ? "" : "s"}, {draft.routes.reduce((sum, route) => sum + route.percent, 0)}% of the keep routed</strong></div>
        <div><span>Cash-out tax</span><strong>30% stays with remaining holders</strong></div>
      </div>
      <div className="flex flex-col items-stretch gap-[.7rem] min-[621px]:items-end">
        <div className="grid w-full gap-2">
          <label htmlFor="deploy-environment" className={LABEL}>Network environment</label>
          <select id="deploy-environment" className={SELECT} disabled={locked} value={testnet ? "testnet" : "mainnet"}
            onChange={event => {
              const nextChains = event.target.value === "testnet" ? TESTNET_CHAIN_IDS : MAINNET_CHAIN_IDS;
              if (!locked) {
                setEnvironment(event.target.value === "testnet" ? "testnet" : "mainnet");
                setDraft(previous => ({ ...previous, chainIds: [...nextChains],
                  routes: previous.routes.filter(route => nextChains.some(chainId => route.machine.ids[chainId])) }));
              }
            }}>
            <option value="mainnet">Mainnets</option>
            <option value="testnet">Sepolia testnets</option>
          </select>
          <label className={LABEL}>
            Chains <span className={HINT}>Choose where your machine will launch.</span>
          </label>
          <div className="flex flex-wrap gap-[1.2rem]">
            {chainIds.map((chainId) => (
              <label key={chainId} className="inline-flex cursor-pointer items-center gap-[.4rem] text-[.9rem]">
                <input
                  type="checkbox" disabled={locked} className="m-0 accent-black"
                  checked={draft.chainIds.includes(chainId)}
                  onChange={(e) =>
                    set(
                      "chainIds",
                      e.target.checked
                        ? [...draft.chainIds, chainId].sort((a, b) => chainIds.indexOf(a) - chainIds.indexOf(b))
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
          <>
          {session?.phase !== "done" && <button
            type="submit"
            disabled={busy || uploadingMedia || restoring || storageBlocked}
            className="display w-full cursor-pointer border-2 border-black bg-black px-[1.7em] py-[.75em] text-[clamp(1.1rem,2.4vw,1.5rem)] tracking-[.03em] text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-40 min-[621px]:w-auto"
          >
            {restoring ? "Checking saved deployment…" : busy ? "Deploying…" : session ? "Resume deployment" : "Deploy"}
          </button>}
          {address && <p className="m-0 flex max-w-full items-baseline justify-center gap-1 text-[.8rem] leading-relaxed text-[#555] min-[621px]:justify-end">
            <span className="shrink-0">Signed in as</span>
            <span title={address} aria-label={ensName ? `${ensName}, ${address}` : address} className="min-w-0 max-w-[20rem] truncate font-mono text-black">
              {ensName || `${address.slice(0, 6)}…${address.slice(-4)}`}
            </span>
          </p>}
          </>
        )}

        <span role={error ? "alert" : undefined} className="text-center text-[.85rem] text-[#555] min-[621px]:text-right">
          {error ?? progress ?? (session?.phase === "done" ? "Your machine is live on every selected chain."
            : draft.chainIds.length > 1 ? "Sign each chain's deployment, then choose a Relayr quote and pay once. Contract wallets use direct transactions."
              : "Review the deployment, then confirm it in your wallet.")}
        </span>
        {session && <p className="m-0 max-w-full break-all text-sm text-[#555]">
          Saved deployment wallet: {session.account}
        </p>}
        {session && canClear && <button type="button" disabled={busy || restoring}
          className="cursor-pointer bg-transparent text-sm underline underline-offset-4 disabled:opacity-40"
          onClick={() => void clear()}>{session.phase === "done" ? "Create another machine" : "Change setup"}</button>}

        {steps.length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0 text-[.8rem] text-[#555]">
            {steps.map((step) => (
              <li key={step.chainId}>
                {step.label}: {step.status}
                {step.hash ? ` ${step.hash.slice(0, 10)}…` : ""}
                {session?.transport === "direct" && step.status !== "done" && (step.hash || step.status === "uncertain") && <label className="mt-2 block text-sm">
                  Executed transaction hash on {step.label}
                  <span className="mb-1 block text-xs">For a Safe proposal or a wallet transaction already sent, paste its mined hash to check it.</span>
                  <input type="text" spellCheck={false} autoComplete="off" disabled={busy}
                    className={`${FIELD} mt-1 font-mono text-xs`} placeholder="0x…"
                    value={executionInputs[session.id]?.[step.chainId] ?? ""}
                    onChange={event => setExecutionInputs(previous => ({...previous,
                      [session.id]: {...previous[session.id], [step.chainId]: event.target.value},
                    }))} />
                </label>}
              </li>
            ))}
          </ul>
        )}
      </div>
            </section>
          </div>
        </div>
      </form>
      {approval && <Suspense fallback={<p role="status">Loading deployment review…</p>}>
        <DeployApproval key={approval.id} approval={approval} onAnswer={answerApproval} />
      </Suspense>}
    </div>
  );
}
