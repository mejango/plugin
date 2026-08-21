import type { ChainProjectIds } from "@/lib/bendystraw/operations";
import type { SupportedChainId } from "@/lib/chains";
import type { DoublingKey } from "@/lib/telligence/house";

/** A machine the user routes part of their keep to. */
export type RouteTarget = {
  name: string;
  symbol: string;
  ids: ChainProjectIds;
};

/** One configured route: who, how much of the keep, and whether it's permanent. */
export type Route = {
  machine: RouteTarget;
  percent: number;
  locked: boolean;
};

/** Everything the create form collects. */
export type MachineDraft = {
  name: string;
  id: string;
  goal: string;
  address: string;
  keepPercent: number;
  doubling: DoublingKey;
  routes: Route[];
  chainIds: SupportedChainId[];
};
