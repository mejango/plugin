import type { SupportedChainId } from "@/lib/chains";
import type { Machine } from "@/lib/machines";
import type { DoublingKey } from "@/lib/plugin/house";

/** One configured route: who, how much of the keep, and whether it's permanent. */
export type Route = {
  machine: Machine;
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
