"use client";

import { useCallback, useEffect, useRef, type JSX } from "react";

/**
 * The issuance breakdown: who gets what out of every dollar paid in. Payers
 * first, then the machine's own keep, then a slice per route it hands away.
 * Grayscale by design — a verbatim port of the approved static readout.
 */

const ROUTE_COLORS = ["#777", "#999", "#555", "#bbb", "#888", "#666"];

type Route = { name: string; percentOfKeep: number };
type Slice = { label: string; pct: number; color: string };

/** Payers, the machine's remainder, then each route — in drawing order. */
function buildSlices(keepPercent: number, routes: Route[]): Slice[] {
  const slices: Slice[] = [{ label: "Payers", pct: 100 - keepPercent, color: "#e8e8e8" }];
  let routed = 0;
  routes.forEach((route, i) => {
    const share = (keepPercent * route.percentOfKeep) / 100;
    routed += share;
    slices.push({ label: route.name, pct: share, color: ROUTE_COLORS[i % ROUTE_COLORS.length] });
  });
  slices.splice(1, 0, {
    label: "The machine",
    pct: Math.max(0, keepPercent - routed),
    color: "#111",
  });
  return slices;
}

function amount(n: number): string {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export function IssuancePie({
  keepPercent,
  routes,
  tokenWord,
  hoverTokensPerDollar,
}: {
  /** 0..100 */
  keepPercent: number;
  /** each route's share OF THE KEEP, 0..100 */
  routes: Route[];
  tokenWord: string;
  /** when non-null, the legend also counts tokens per slice. */
  hoverTokensPerDollar: number | null;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slices = buildSlices(keepPercent, routes);
  const shown = slices.filter((sl) => sl.pct > 0);
  const shownRef = useRef(shown);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth * dpr;
    const ch = canvas.clientHeight * dpr;
    if (!cw) return;
    canvas.width = cw;
    canvas.height = ch;
    const px = canvas.getContext("2d");
    if (!px) return;

    px.clearRect(0, 0, cw, ch);
    const cxp = cw / 2;
    const cyp = ch / 2;
    const r = Math.min(cw, ch) / 2 - 4 * dpr;
    let a = -Math.PI / 2;
    const bounds: number[] = [];
    for (const sl of shownRef.current) {
      const a2 = a + (sl.pct / 100) * Math.PI * 2;
      px.beginPath();
      px.moveTo(cxp, cyp);
      px.arc(cxp, cyp, r, a, a2);
      px.closePath();
      px.fillStyle = sl.color;
      px.fill();
      bounds.push(a);
      a = a2;
    }
    // seams as clean radius lines — stroking wedge outlines chews up the center
    if (shownRef.current.length > 1) {
      px.strokeStyle = "#fff";
      px.lineWidth = 2 * dpr;
      for (const b of bounds) {
        px.beginPath();
        px.moveTo(cxp, cyp);
        px.lineTo(cxp + Math.cos(b) * r, cyp + Math.sin(b) * r);
        px.stroke();
      }
    }
  }, []);

  // Latest slices in, fresh paint out — runs after every render.
  useEffect(() => {
    shownRef.current = shown;
    draw();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [draw]);

  return (
    <>
      <canvas ref={canvasRef} className="block w-full" style={{ height: 210 }} />
      <div className="grid gap-[0.3rem] text-[0.78rem] text-[#555]">
        {shown.map((sl, i) => (
          <div key={sl.label + i} className="flex items-center gap-2">
            <span
              className="h-[0.7rem] w-[0.7rem] flex-none border border-black/25"
              style={{ background: sl.color }}
            />
            <span>
              {sl.label} — {Math.round(sl.pct * 10) / 10}%
              {hoverTokensPerDollar !== null ? (
                <span className="text-[#aaa]">
                  {" "}
                  {amount((hoverTokensPerDollar * sl.pct) / 100)} {tokenWord} per $1
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
