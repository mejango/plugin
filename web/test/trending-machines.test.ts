import { describe, expect, it } from "vitest";
import { trendingMachines, type TrendingProject, type TrendingData } from "@/lib/trending-machines";

const project: TrendingProject = { projectId: 6, chainId: 8453, name: "Artizen", balance: "12500000", tokenSymbol: "USDC", decimals: 6, currency: "3181390099", deployErc20Events: { items: [{ symbol: "$ART" }] } };
const data = (projects: TrendingProject[]): TrendingData => ({ suckerGroups: { items: [{ id: "artizen", projects: { items: projects } }] } });

describe("trending machine readout", () => {
  it("shows the issued ticker, not the backing currency", () => {
    expect(trendingMachines(data([project]))[0]).toMatchObject({ ticker: "ART", name: "Artizen", balance: "12.5 USDC" });
  });
  it("sums matching balances across chains as integers", () => {
    expect(trendingMachines(data([project, { ...project, chainId: 1, balance: "1000000" }]))[0].balance).toBe("13.5 USDC");
  });
  it("keeps different currencies separate", () => {
    const eth = { ...project, chainId: 1, currency: "61166", tokenSymbol: "ETH", decimals: 18, balance: "1000000000000000000" };
    expect(trendingMachines(data([project, eth]))[0].balance).toBe("12.5 USDC + 1 ETH");
  });
  it("does not invent a ticker or round a tiny positive balance to zero", () => {
    expect(trendingMachines(data([{ ...project, balance: "1", deployErc20Events: { items: [] } }]))[0])
      .toMatchObject({ ticker: "—", balance: "<0.0001 USDC" });
  });
  it("omits empty groups and marks unknown units unavailable", () => {
    expect(trendingMachines(data([]))).toEqual([]);
    expect(trendingMachines(data([{ ...project, decimals: null }]))[0].balance).toBe("—");
  });
});
