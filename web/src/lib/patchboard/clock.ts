// Normal frame delays consume real elapsed time. Only a suspension (e.g. a
// hidden tab, debugger pause, or hot reload) starts a fresh frame clock.
export function frameSeconds(previous: number | null, now: number): number {
  if (previous === null) return 0;
  const elapsed = (now - previous) / 1000;
  return elapsed > 0.5 ? 0 : Math.max(0, elapsed);
}
