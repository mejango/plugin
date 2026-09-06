export const DEFAULT_FEEL = {
  bend: 8, settling: 30, damping: 8, cordFriction: 0.5, floorFriction: 0.95,
  grip: 0.35, stretch: 0.01, plugWeight: 3.75, socketResistance: 0.38,
  shapeMemory: true, socketAssist: true,
};
export type CableFeel = typeof DEFAULT_FEEL;
// Keep the experiment's alternative presets unchanged when tuning the homepage.
const EXPERIMENT_BASE: CableFeel = {
  bend: 1.5, settling: 10, damping: 2.8, cordFriction: 0.65, floorFriction: 0.85,
  grip: 0.14, stretch: 0.02, plugWeight: 3, socketResistance: 0.22,
  shapeMemory: true, socketAssist: true,
};
export const FEEL_SLIDERS = [
  { key: "bend", label: "Bending stiffness", min: 0.05, max: 8, step: 0.05, hint: "Soft and floppy → firm, shape-holding loops." },
  { key: "settling", label: "Settling strength", min: 0, max: 30, step: 0.5, hint: "Springy, lasting swing → quickly damped, little wobble." },
  { key: "damping", label: "Motion damping", min: 0, max: 8, step: 0.1, hint: "Damps flexing and vibration inside the cable, without slowing free fall." },
  { key: "cordFriction", label: "Cable grip", min: 0, max: 1.5, step: 0.05, hint: "Rubber-on-rubber resistance at crossings." },
  { key: "floorFriction", label: "Surface grip", min: 0, max: 1.5, step: 0.05, hint: "Resists sliding on the floor and panel." },
  { key: "grip", label: "Body handling", min: 0.04, max: 0.35, step: 0.01, hint: "Grip strength when shaping the middle. Held plugs track the mouse directly." },
  { key: "stretch", label: "Cable stretch", min: 0, max: 1, step: 0.01, hint: "Allows more extension under tension." },
  { key: "plugWeight", label: "Plug weight", min: 1, max: 6, step: 0.25, hint: "Connector mass relative to the cable." },
  { key: "socketResistance", label: "Socket hold", min: 0, max: 0.6, step: 0.02, hint: "How far you pull before a seated plug releases." },
] as const;
export const FEEL_PRESETS: Record<string, CableFeel> = {
  "¼-inch cable": { ...DEFAULT_FEEL },
  "Soft cable": { ...EXPERIMENT_BASE, bend: 0.25, settling: 2, damping: 1.6, cordFriction: 0.4, grip: 0.2, plugWeight: 2, socketResistance: 0.12 },
  "Heavy rubber": { ...EXPERIMENT_BASE, bend: 3, settling: 16, damping: 4.5, cordFriction: 1.15, floorFriction: 1.2, grip: 0.1, plugWeight: 4.5, socketResistance: 0.34 },
  "Firm + fast settling": { ...EXPERIMENT_BASE, bend: 5, settling: 24, damping: 5 },
};
export function sanitizeFeel(input: unknown): CableFeel {
  const result = { ...DEFAULT_FEEL };
  if (!input || typeof input !== "object") return result;
  const values = input as Record<string, unknown>;
  for (const s of FEEL_SLIDERS) {
    const n = values[s.key];
    if (typeof n === "number" && Number.isFinite(n)) result[s.key] = Math.max(s.min, Math.min(s.max, n));
  }
  for (const key of ["shapeMemory", "socketAssist"] as const) {
    if (typeof values[key] === "boolean") result[key] = values[key];
  }
  return result;
}
