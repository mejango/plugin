import { expect, it } from "vitest";
import { PatchWorld } from "../src/lib/patchboard/physics";
import { add, distance, lerp, v } from "../src/lib/patchboard/math";
import { FEEL_PRESETS } from "../src/lib/patchboard/settings";

it("does not cancel a pending insertion when another end is grabbed", () => {
  const w = new PatchWorld();
  w.grab(0, 0); w.release(0);
  expect(w.grip).toBeNull();
  expect(w.docking).toHaveLength(1);
  expect(w.occupied(0)).toBe(true);
  w.grab(1, 72);
  expect(w.docking).toHaveLength(1);
  for (let i = 0; i < 20; i++) w.advance(1 / 60);
  expect(w.cords[0].ports[0]).toBe(0);
  expect(w.docking).toHaveLength(0);
  expect(w.grip?.cord).toBe(1);
  expect(w.grip?.index).toBe(72);
  expect(w.cords[0].nodes[0].mass).toBe(0);
});

it("tracks independent pending insertions and only cancels the explicitly grabbed end", () => {
  const w = new PatchWorld();
  w.grab(0, 0);w.release(0);
  w.grab(1, 0);w.release(3);
  expect(w.docking).toHaveLength(2);
  w.grab(0, 0);
  expect(w.docking.map(d => d.cord)).toEqual([1]);
  for(let i=0;i<20;i++)w.advance(1/60);
  expect(w.cords[1].ports[0]).toBe(3);
  expect(w.cords[0].ports[0]).toBeNull();
  expect(w.grip?.cord).toBe(0);
});

it("keeps other seated plugs fixed when a held end presses across them", () => {
  const w = new PatchWorld();
  const seated = w.cords.slice(1).map(c => ({ ports: [...c.ports], a: { ...c.nodes[0].p }, b: { ...c.nodes[72].p } }));
  w.grab(0, 72);
  const start = { ...w.cords[0].nodes[72].p }, target = { ...w.cords[1].nodes[0].p };
  for(let i=1;i<=45;i++){
    w.grip!.target=lerp(start,target,i/45);w.advance(1/60);
    w.cords.slice(1).forEach((c,j)=>{
      expect(c.ports).toEqual(seated[j].ports);
      expect(distance(c.nodes[0].p,seated[j].a)).toBe(0);
      expect(distance(c.nodes[72].p,seated[j].b)).toBe(0);
    });
    expect(w.grip?.cord).toBe(0);
    expect(w.grip?.index).toBe(72);
  }
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});

it.each(Object.entries(FEEL_PRESETS))("fully inserts an angled plug under cable tension with %s",(_,feel)=>{
  const w=new PatchWorld({columns:12,rows:7,top:7.45,gap:1.05});w.configure(feel);
  w.grab(2,72);
  const target=w.sockets[11];
  w.grip!.target={...target,z:1.2};
  for(let i=0;i<45;i++)w.advance(1/60);
  expect(distance(w.cords[2].nodes[72].p,target)).toBeGreaterThan(0.65);
  expect(distance(w.cords[2].nodes[72].p,target)).toBeLessThan(1.5);
  w.release(11,true);
  expect(w.docking).toHaveLength(1);
  for(let i=0;i<120;i++)w.advance(1/60);
  expect(w.cords[2].ports[1],JSON.stringify(w.diagnostics())).toBe(11);
  expect(w.cords[2].nodes[72].p).toEqual(target);
  expect(w.cords[2].nodes[71].p).toEqual(add(target,v(0,0,0.22)));
  expect(w.docking).toHaveLength(0);
  expect(w.diagnostics().penetration).toBeLessThan(0.004);
});
