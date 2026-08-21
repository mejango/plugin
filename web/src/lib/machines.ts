"use client";

import { queryBendystraw } from "@/lib/bendystraw/client";
import {
  BendystrawOperations,
  type ChainProjectIds,
  type ProjectRow,
} from "@/lib/bendystraw/operations";

/** A machine as the routes panel shows it: identity plus its per-chain twins. */
export type Machine = {
  name: string;
  symbol: string;
  ids: ChainProjectIds;
};

/** Revnet itself — every machine ships routed into it by default. */
export const REV_MACHINE: Machine = {
  name: "Revnet",
  symbol: "REV",
  ids: { 1: 3, 10: 3, 8453: 3, 42161: 3 },
};

/** Search v6 projects by name, one row per sucker group. */
export async function searchMachines(text: string): Promise<ProjectRow[]> {
  const data = await queryBendystraw<{ projects: { items: ProjectRow[] } }>(
    BendystrawOperations.SearchProjects,
    { where: { AND: [{ version: 6 }, { name_contains_nocase: text }] }, limit: 8 },
  );
  const seen = new Set<string>();
  const hits: ProjectRow[] = [];
  for (const row of data.projects.items) {
    const key = row.suckerGroupId ?? `${row.chainId}:${row.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(row);
  }
  return hits.slice(0, 5);
}

/**
 * Resolve a project to its per-chain project IDs. Omnichain projects carry a
 * DIFFERENT id on every chain, so a route must bake the right one into each
 * chain's split — never reuse the id you searched with.
 */
export async function resolveChainIds(row: ProjectRow): Promise<ChainProjectIds> {
  if (!row.suckerGroupId) return { [row.chainId]: row.projectId };
  const data = await queryBendystraw<{
    suckerGroup: { projects: { items: { chainId: number; projectId: number }[] } };
  }>(BendystrawOperations.SuckerGroup, { id: row.suckerGroupId });
  const ids: ChainProjectIds = {};
  for (const p of data.suckerGroup.projects.items) ids[p.chainId] = p.projectId;
  return ids;
}
