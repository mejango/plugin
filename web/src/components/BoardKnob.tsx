"use client";

import { useRef, type CSSProperties } from "react";
import styles from "./HomeHero.module.css";

export function BoardKnob({ label, value, max, step, text, onChange, style, cycle = false }: {
  label: string; value: number; max: number; step: number; text: string;
  onChange: (value: number) => void; style: CSSProperties; cycle?: boolean;
}) {
  const drag = useRef<{ id: number; x: number; y: number; value: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const set = (next: number) => onChange(Math.max(0, Math.min(max, step ? Math.round(next / step) * step : next)));
  return <button className={styles.mode} type="button" role="slider" aria-label={label}
    aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text}
    title={`${label}: ${text}. Drag up or right to increase, down or left to decrease. Arrow keys also work.`}
    style={style}
    onPointerDown={event => {
      if(event.button !== 0)return;
      drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,value,moved:false};
      suppressClick.current=false;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start=drag.current;if(!start||start.id!==event.pointerId)return;
      const dx=event.clientX-start.x,dy=start.y-event.clientY;
      if(Math.hypot(dx,dy)>3)start.moved=true;
      if(start.moved){event.preventDefault();set(start.value+(dx+dy)*max/(event.shiftKey?600:150));}
    }}
    onPointerUp={event=>{
      if(drag.current?.id!==event.pointerId)return;
      suppressClick.current=drag.current.moved;drag.current=null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={()=>{suppressClick.current=true;drag.current=null;}}
    onLostPointerCapture={()=>{if(drag.current){suppressClick.current=drag.current.moved;drag.current=null;}}}
    onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}if(cycle)onChange((value+1)%(max+1));}}
    onKeyDown={event=>{
      if(event.key==='Home'||event.key==='End'){event.preventDefault();set(event.key==='Home'?0:max);}
      else if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)){
        event.preventDefault();set(value+(['ArrowUp','ArrowRight'].includes(event.key)?1:-1)*(step||max/100));
      }
    }}><span className="sr-only">{text}</span></button>;
}
