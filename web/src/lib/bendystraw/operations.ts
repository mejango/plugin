/**
 * The operation catalog. Ids are the ONLY thing the browser knows — GraphQL
 * documents live server-side in registry.server.ts, so queries can't be rewritten
 * from the client. This mirrors the revnet-money / juicebox-money pattern.
 */
export const BendystrawOperations = {
  SearchProjects: "SearchProjects",
  SuckerGroup: "SuckerGroup",
  Project: "Project",
} as const;

export type BendystrawOperation =
  (typeof BendystrawOperations)[keyof typeof BendystrawOperations];

export function isBendystrawOperation(value: unknown): value is BendystrawOperation {
  return typeof value === "string" && value in BendystrawOperations;
}

/** A project row as every surface here consumes it. */
export type ProjectRow = {
  projectId: number;
  chainId: number;
  suckerGroupId: string | null;
  name: string | null;
  tokenSymbol: string | null;
  decimals: number | null;
  isRevnet: boolean | null;
};

/** (chainId -> projectId) for one machine across every chain it lives on. */
export type ChainProjectIds = Record<number, number>;
