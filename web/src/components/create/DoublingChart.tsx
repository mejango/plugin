"use client";

import { useCallback, useEffect, useRef, type JSX } from "react";

import {
  DOUBLINGS,
  INITIAL_ISSUANCE_PER_USD,
  doublingFor,
  tokensPerDollarAt,
  type DoublingKey,
} from "@/lib/telligence/house";

/**
 * The step chart: what a dollar buys across a machine's first year, one
 * staircase per doubling cadence, log2 on the y-axis. The drawing is a verbatim
 * port of the approved static readout — treat the numbers here as design.
 */

/** Top of the chart: 2^12, past which every cadence is off the page. */
const MAX_DOUBLINGS = 12;
const YEAR_DAYS = 365;
/** A month, in days — the x-axis speaks in months, the model speaks in days. */
const MONTH_DAYS = 30.42;

/** Plot padding in CSS pixels; the pointer math needs the same numbers. */
const PAD_L = 52;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

function amount(n: number): string {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export function DoublingChart({
  selected,
  tokenWord,
  onHoverDay,
}: {
  selected: DoublingKey;
  /** e.g. "FORAGE" or "tokens" — what the tooltip counts. */
  tokenWord: string;
  /** day 0..365 under the cursor, null on leave. */
  onHoverDay?: (day: number | null) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverDayRef = useRef<number | null>(null);
  // The draw reads the latest props without re-binding listeners.
  const propsRef = useRef({ selected, tokenWord });
  // Kept in a ref so the pointer listeners never need re-binding.
  const onHoverDayRef = useRef(onHoverDay);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth * dpr;
    const ch = canvas.clientHeight * dpr;
    if (!cw) return;
    canvas.width = cw;
    canvas.height = ch;
    const cx = canvas.getContext("2d");
    if (!cx) return;

    const { selected: key, tokenWord: word } = propsRef.current;
    const hoverDay = hoverDayRef.current;

    const padL = PAD_L * dpr;
    const padR = PAD_R * dpr;
    const padT = PAD_T * dpr;
    const padB = PAD_B * dpr;
    const plotW = cw - padL - padR;
    const plotH = ch - padT - padB;
    const X = (day: number) => padL + (day / YEAR_DAYS) * plotW;
    const Y = (dbl: number) => padT + plotH - (Math.min(dbl, MAX_DOUBLINGS) / MAX_DOUBLINGS) * plotH;

    cx.clearRect(0, 0, cw, ch);
    // gridlines + y labels at 1x, 16x, 256x, 4096x
    cx.font = 9 * dpr + "px ui-monospace, Menlo, monospace";
    cx.fillStyle = "#999";
    cx.strokeStyle = "#eee";
    cx.lineWidth = 1 * dpr;
    for (const d of [0, 4, 8, 12]) {
      cx.beginPath();
      cx.moveTo(padL, Y(d));
      cx.lineTo(cw - padR, Y(d));
      cx.stroke();
      cx.textAlign = "right";
      // real issuance pricing: 1,000 tokens per USD at start => $0.001, doubling from there
      cx.fillText("$" + ((1 / INITIAL_ISSUANCE_PER_USD) * 2 ** d).toFixed(3), padL - 5 * dpr, Y(d) + 3 * dpr);
    }
    // x labels: quarters. 0mo hugs the left, 12mo the right, so neither clips.
    for (const m of [0, 3, 6, 9, 12]) {
      cx.textAlign = m === 0 ? "left" : m === 12 ? "right" : "center";
      cx.fillText(m + "mo", X(m * MONTH_DAYS), ch - 8 * dpr);
    }

    // unselected first, selected drawn last on top
    const cadences = [...DOUBLINGS].sort(
      (a, b) => Number(a.key === key) - Number(b.key === key),
    );
    for (const cadence of cadences) {
      const period = cadence.days;
      const sel = cadence.key === key;
      cx.strokeStyle = sel ? "#000" : "#d4d4d4";
      cx.lineWidth = (sel ? 2.5 : 1.5) * dpr;
      cx.beginPath();
      let dbl = 0;
      cx.moveTo(X(0), Y(0));
      for (let day = period; day <= YEAR_DAYS && dbl < MAX_DOUBLINGS; day += period) {
        cx.lineTo(X(day), Y(dbl)); // run flat to the doubling…
        dbl += 1;
        cx.lineTo(X(day), Y(dbl)); // …then step up
      }
      if (dbl < MAX_DOUBLINGS) cx.lineTo(X(YEAR_DAYS), Y(dbl));
      cx.stroke();
    }

    // hover: marker on the selected staircase + a values tooltip
    if (hoverDay !== null) {
      const period = doublingFor(key).days;
      const k = Math.min(Math.floor(hoverDay / period), MAX_DOUBLINGS);
      const tokens = tokensPerDollarAt(key, k * period);
      const hx = X(hoverDay);
      const hy = Y(k);
      cx.strokeStyle = "#bbb";
      cx.lineWidth = 1 * dpr;
      cx.setLineDash([3 * dpr, 3 * dpr]);
      cx.beginPath();
      cx.moveTo(hx, padT);
      cx.lineTo(hx, ch - padB);
      cx.stroke();
      cx.setLineDash([]);
      cx.beginPath();
      cx.arc(hx, hy, 3.5 * dpr, 0, 7);
      cx.fillStyle = "#000";
      cx.fill();
      const l1 = "month " + (hoverDay / MONTH_DAYS).toFixed(1);
      const l2 = amount(tokens) + " " + word + " per $1";
      cx.font = 9 * dpr + "px ui-monospace, Menlo, monospace";
      const tw = Math.max(cx.measureText(l1).width, cx.measureText(l2).width) + 12 * dpr;
      const th = 30 * dpr;
      let bxp = hx + 10 * dpr;
      if (bxp + tw > cw - padR) bxp = hx - tw - 10 * dpr; // flip left near the right edge
      const byp = Math.max(padT, Math.min(hy - th / 2, ch - padB - th));
      cx.fillStyle = "rgba(255,255,255,0.95)";
      cx.fillRect(bxp, byp, tw, th);
      cx.strokeStyle = "#000";
      cx.strokeRect(bxp, byp, tw, th);
      cx.fillStyle = "#000";
      cx.textAlign = "left";
      cx.fillText(l1, bxp + 6 * dpr, byp + 12 * dpr);
      cx.fillText(l2, bxp + 6 * dpr, byp + 24 * dpr);
    }
  }, []);

  // Latest props in, fresh paint out — runs after every render.
  useEffect(() => {
    propsRef.current = { selected, tokenWord };
    onHoverDayRef.current = onHoverDay;
    draw();
  });

  // Pointer + resize wiring, bound once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const frac = (e.clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R);
      const day = Math.max(0, Math.min(YEAR_DAYS, frac * YEAR_DAYS));
      hoverDayRef.current = day;
      draw();
      onHoverDayRef.current?.(day);
    };
    const onPointerLeave = () => {
      hoverDayRef.current = null;
      draw();
      onHoverDayRef.current?.(null);
    };
    const onResize = () => draw();

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [draw]);

  return <canvas ref={canvasRef} className="block w-full touch-none" style={{ height: 230 }} />;
}
