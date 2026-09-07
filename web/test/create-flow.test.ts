import { describe, expect, it } from "vitest";
import { createIssues } from "@/lib/plugin/create-flow";
import { DEFAULT_DOUBLING, DEFAULT_KEEP_PERCENT } from "@/lib/plugin/house";
import type { MachineDraft } from "@/lib/plugin/types";

const draft: MachineDraft = { name: "Foraging Bot", id: "FORAGE", goal: "Find food for the neighborhood.", address: "0x1111111111111111111111111111111111111111", keepPercent: DEFAULT_KEEP_PERCENT, doubling: DEFAULT_DOUBLING, routes: [], chainIds: [1] };

describe("creation page validation", () => {
  it("accepts a complete draft", () => expect(createIssues(draft)).toEqual([]));
  it("points missing identity and goal fields to their pages", () => {
    expect(createIssues({ ...draft, name: " ", id: "$BAD", address: "0x123", goal: " " }).map(issue => issue.page)).toEqual([0, 0, 0, 1]);
  });
  it("prevents over-allocating the keep across multiple plug ins", () => {
    const machine = { name: "Example", symbol: "EX", ids: { 1: 1 } };
    expect(createIssues({ ...draft, routes: [{ machine, percent: 70, locked: false }, { machine, percent: 40, locked: true }] })).toEqual([expect.objectContaining({ page: 3 })]);
  });
  it("rejects fractional route percentages and requires a chain", () => {
    const machine = { name: "Example", symbol: "EX", ids: { 1: 1 } };
    expect(createIssues({ ...draft, routes: [{ machine, percent: 1.5, locked: false }], chainIds: [] }).map(issue => issue.page)).toEqual([3, 6]);
  });
  it("allows routing exactly all the keep", () => {
    const machine = { name: "Example", symbol: "EX", ids: { 1: 1 } };
    expect(createIssues({ ...draft, routes: [{ machine, percent: 100, locked: true }] })).toEqual([]);
  });
  it("requires one network family and accepts Sepolia destinations", () => {
    expect(createIssues({...draft, chainIds: [11155111, 11155420, 84532, 421614]})).toEqual([]);
    expect(createIssues({...draft, chainIds: [1, 11155111]})).toEqual([expect.objectContaining({page: 6})]);
    expect(createIssues({...draft, chainIds: [1, 1]})).toEqual([expect.objectContaining({page: 6})]);
  });
});
