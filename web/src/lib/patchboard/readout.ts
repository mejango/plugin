import type { TrendingMachine } from "@/lib/trending-machines";

export const VIEW_MODES = ["top", "trending", "latest", "new"] as const;
export type ViewMode = typeof VIEW_MODES[number];
export type MachineReadout = { machines: TrendingMachine[] | null; failed: boolean; mode?: ViewMode; programming?: boolean };
let current: MachineReadout = { machines: null, failed: false };
const listeners = new Set<() => void>();
export function machineReadout() { return current; }
export function publishMachineReadout(value: MachineReadout) {
  current = value;
  for (const listener of listeners) listener();
}
export function subscribeMachineReadout(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
