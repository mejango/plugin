import { describe, expect, it } from "vitest";
import { encodeFunctionData, zeroAddress } from "viem";
import { revDeployerAbi } from "@bananapus/nana-sdk-core";
import { buildDeployArgs, deployerFor, buildPitchUri } from "@/lib/plugin/deploy";
import type { MachineDraft } from "@/lib/plugin/types";
import { REV_MACHINE } from "@/lib/machines";
import { TESTNET_CHAIN_IDS } from "@/lib/chains";
const salt=`0x${"12".repeat(32)}` as const;
const draft:MachineDraft={name:" Test ",id:"test",goal:"A goal",address:"0x1111111111111111111111111111111111111111",keepPercent:10,doubling:"1m",routes:[{machine:REV_MACHINE,percent:10,locked:true}],chainIds:[1,10,8453,42161]};
describe("Revnet deployment configuration",()=>{
  it.each([1,10,8453,42161])("encodes the explicit V6 store overload on chain %s",chain=>{
    const args=buildDeployArgs(draft,"ipfs://pitch",chain,salt,1800000000);
    expect(encodeFunctionData({abi:revDeployerAbi,functionName:"deployFor",args})).toMatch(/^0x/);
    expect(deployerFor(chain)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(args[1].description).toEqual({name:"Test",ticker:"TEST",uri:"ipfs://pitch",salt});
    expect(args[1].stageConfigurations[0]).toMatchObject({initialIssuance:1000n*10n**18n,splitPercent:1000,issuanceCutPercent:500000000,cashOutTaxRate:3000,extraMetadata:4,issuanceCutFrequency:30*86400});
    expect(args[1].stageConfigurations[0].splits.reduce((total,s)=>total+s.percent,0)).toBe(1000000000);
    expect(args[2].map(c=>c.decimals)).toEqual([18,6]);
    expect(args[3].deployerConfigurations).toHaveLength(3);
    expect(args[3].salt).toBe(salt);
    expect(args[4].baseline721HookConfiguration.tiersConfig).toEqual({tiers:[],currency:2,decimals:6});
  });
  it("uses 90 days quarterly and no bridges on one chain",()=>{
    const args=buildDeployArgs({...draft,doubling:"3m",chainIds:[1]},"ipfs://pitch",1,salt,1800000000);
    expect(args[1].stageConfigurations[0].issuanceCutFrequency).toBe(90*86400);
    expect(args[3].deployerConfigurations).toEqual([]);
  });
  it("rejects zero operators and invalid route totals",()=>{
    expect(()=>buildDeployArgs({...draft,address:zeroAddress},"",1,salt,1800000000)).toThrow("address");
    expect(()=>buildDeployArgs({...draft,routes:[{machine:REV_MACHINE,percent:101,locked:false}]},"",1,salt,1800000000)).toThrow("100%");
  });
  it("preserves Unicode goals in metadata",()=>{
    const uri=buildPitchUri({...draft,goal:"世界"},"Manual");
    expect(JSON.parse(Buffer.from(uri.split(",")[1],"base64").toString()).description).toBe("世界");
  });
  it.each(TESTNET_CHAIN_IDS)("encodes paired V6 Sepolia deployments on chain %s", chainId => {
    const args = buildDeployArgs({...draft, chainIds: [...TESTNET_CHAIN_IDS]}, "ipfs://pitch", chainId, salt, 1800000000);
    expect(encodeFunctionData({abi: revDeployerAbi, functionName: "deployFor", args})).toMatch(/^0x/);
    expect(args[3].deployerConfigurations).toHaveLength(3);
    expect(args[3].salt).toBe(salt);
    expect(args[1].stageConfigurations[0].startsAtOrAfter).toBe(1800000000);
  });
  it("rejects mixed network families and duplicate deployment destinations", () => {
    expect(() => buildDeployArgs({...draft, chainIds: [1, 11155111]}, "", 1, salt, 1800000000)).toThrow("one network environment");
    expect(() => buildDeployArgs({...draft, chainIds: [1, 1]}, "", 1, salt, 1800000000)).toThrow("distinct");
  });
});
