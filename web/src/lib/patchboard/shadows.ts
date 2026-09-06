import { lerp, v, type V3 } from "./math";
import { PLUG_RADIUS, RADIUS, type Cord } from "./physics";

export const PANEL_SHADOW_Z = 0.002;
export const PATCH_LIGHTS = [v(-4.1, 8.8, 5), v(4.1, 8.8, 5)];
type ShadowPoint = { p: V3; radius: number };

// Include the connector silhouette, not just the cable's particle centerline.
// A seated shaft continues into the panel, so both lights' shadows originate
// inside the socket. A loose or still-docking tip has no such connection.
export function cableShadowSpine(cord: Cord): ShadowPoint[] {
  const { nodes, ports } = cord;
  const connector = (end: 0 | 1): ShadowPoint[] => {
    const tip = nodes[end === 0 ? 0 : nodes.length - 1].p;
    const elbow = nodes[end === 0 ? 1 : nodes.length - 2].p;
    if (ports[end] !== null) return [
      { p: v(tip.x, tip.y, PANEL_SHADOW_Z), radius: PLUG_RADIUS },
      { p: tip, radius: PLUG_RADIUS },
      { p: elbow, radius: PLUG_RADIUS * 0.92 },
    ];
    return [
      { p: tip, radius: 0.025 },
      { p: lerp(tip, elbow, 0.1), radius: 0.058 },
      { p: lerp(tip, elbow, 0.61), radius: 0.059 },
      { p: lerp(tip, elbow, 0.7), radius: PLUG_RADIUS * 0.92 },
      { p: elbow, radius: PLUG_RADIUS * 0.92 },
    ];
  };
  return [
    ...connector(0),
    ...nodes.slice(2, -2).map(n => ({ p: n.p, radius: RADIUS })),
    ...connector(1).reverse(),
  ];
}

export function projectShadow(p: V3, light: V3, axis: "y" | "z", plane: number): V3 {
  return lerp(light, p, (plane - light[axis]) / (p[axis] - light[axis]));
}
