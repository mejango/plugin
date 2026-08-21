"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectRow } from "@/lib/bendystraw/operations";
import { CHAIN_NAMES } from "@/lib/chains";
import { resolveChainIds, searchMachines } from "@/lib/machines";
import type { Route } from "@/lib/plugin/types";
import { FIELD, LINK_BTN } from "@/components/create/ui";

function chainsLine(ids: Record<number, number>): string {
  return Object.entries(ids)
    .map(([chainId, projectId]) => `${CHAIN_NAMES[Number(chainId)] ?? chainId} #${projectId}`)
    .join(" · ");
}

export function RoutesPanel({
  routes,
  keepPercent,
  onChange,
}: {
  routes: Route[];
  keepPercent: number;
  onChange: (routes: Route[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<{ term: string; rows: ProjectRow[] } | null>(null);
  const [state, setState] = useState<"idle" | "error">("idle");
  const seq = useRef(0);

  const query = term.trim();
  const searching = query.length >= 2;

  useEffect(() => {
    if (!searching) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const found = await searchMachines(query);
        if (mine !== seq.current) return; // a newer keystroke already won
        setHits({ term: query, rows: found });
        setState("idle");
      } catch {
        if (mine !== seq.current) return;
        setState("error");
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      seq.current += 1; // invalidate any in-flight response for this term
    };
  }, [query, searching]);

  const taken = useMemo(() => new Set(routes.map((r) => JSON.stringify(r.machine.ids))), [routes]);

  async function add(row: ProjectRow) {
    // Per-chain twins, resolved from the sucker group — never the searched id.
    const ids = await resolveChainIds(row);
    if (taken.has(JSON.stringify(ids))) return;
    onChange([
      ...routes,
      {
        machine: { name: row.name ?? `Project #${row.projectId}`, symbol: row.tokenSymbol ?? "", ids },
        percent: 10,
        locked: false,
      },
    ]);
    setTerm("");
  }

  function patch(index: number, next: Partial<Route>) {
    onChange(routes.map((route, i) => (i === index ? { ...route, ...next } : route)));
  }

  return (
    <div className="grid gap-2">
      {routes.length > 0 && (
        <div className="grid gap-2">
          {routes.map((route, index) => (
            <div
              key={JSON.stringify(route.machine.ids)}
              className="grid grid-cols-[1fr_auto] gap-x-[.8rem] gap-y-[.6rem] border border-[#e5e5e5] bg-white px-[.8rem] py-[.7rem]"
            >
              <span className="col-span-full block">
                <b className="display block leading-tight font-normal tracking-[.01em]">{route.machine.name}</b>
                <span className="mt-[.15rem] flex items-baseline gap-[.45rem]">
                  <span className="font-mono text-[.8rem] text-[#555]">{route.machine.symbol || "—"}</span>
                  <span className="text-[.75rem] text-[#ccc]">|</span>
                  <span className="whitespace-nowrap text-[.7rem] tracking-[.04em] text-[#aaa]">
                    {chainsLine(route.machine.ids)}
                  </span>
                </span>
              </span>

              <span className="col-start-1 inline-flex items-center gap-[.4rem] text-[.85rem] text-[#555]">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={route.percent}
                  aria-label={`Percent of the keep routed to ${route.machine.name}`}
                  onChange={(e) =>
                    patch(index, { percent: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })
                  }
                  className="w-[3.2ch] rounded-none border-0 border-b border-black bg-white p-0 pb-[.1rem] text-center text-[.9rem] [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                % of the keep
              </span>

              <span className="col-start-1 -mt-[.35rem] text-[.72rem] text-[#aaa]">
                = {Math.round(((keepPercent * route.percent) / 100) * 10) / 10}% of total issuance
              </span>

              <label className="col-start-1 inline-flex cursor-pointer items-center gap-[.35rem] text-[.75rem] text-[#555]">
                <input
                  type="checkbox"
                  checked={route.locked}
                  onChange={(e) => patch(index, { locked: e.target.checked })}
                  className="m-0 accent-black"
                />
                lock forever
              </label>

              <button
                type="button"
                onClick={() => onChange(routes.filter((_, i) => i !== index))}
                className={`col-start-2 row-span-3 row-start-2 justify-self-end self-end ${LINK_BTN}`}
              >
                unplug
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative grid gap-2">
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search machines to plug in…"
          autoComplete="off"
          className={FIELD}
        />
        {searching && (
          <div className="absolute left-0 right-0 top-full z-20 grid bg-white shadow-[4px_4px_0_rgba(0,0,0,.15)]">
            {state === "error" ? (
              <div className="border border-[#e5e5e5] px-[.8rem] py-[.55rem] text-[#aaa]">search unavailable</div>
            ) : hits?.term !== query ? (
              <div className="border border-[#e5e5e5] px-[.8rem] py-[.55rem] text-[#aaa]">searching…</div>
            ) : hits.rows.length === 0 ? (
              <div className="border border-[#e5e5e5] px-[.8rem] py-[.55rem] text-[#aaa]">no machines found</div>
            ) : (
              hits.rows.map((row) => (
                <button
                  key={`${row.chainId}:${row.projectId}`}
                  type="button"
                  onClick={() => void add(row)}
                  className="block w-full cursor-pointer border border-t-0 border-[#e5e5e5] bg-white px-[.8rem] py-[.55rem] text-left first:border-t hover:bg-[#f4f4f4]"
                >
                  <b className="display block leading-tight font-normal">{row.name ?? `Project #${row.projectId}`}</b>
                  <span className="font-mono text-[.8rem] text-[#555]">{row.tokenSymbol ?? "—"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
