import {
  getJBContractAddress, JBCoreContracts, RevnetCoreContracts, revDeployerAbi,
  MappableAsset, parseSuckerDeployerConfig, NATIVE_TOKEN, USDC_ADDRESSES,
  USD_CURRENCY_ID, SPLITS_TOTAL_PERCENT, MAX_WEIGHT_CUT_PERCENT,
} from "@bananapus/nana-sdk-core";
import { decodeFunctionData, isAddress, zeroAddress, type Address, type Hex, type ContractFunctionArgs } from "viem";
import { assertSupportedChainId, MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "@/lib/chains";
import { doublingFor, keepIndex, INITIAL_ISSUANCE_PER_USD, CASH_OUT_TAX_RATE } from "@/lib/plugin/house";
import type { MachineDraft } from "@/lib/plugin/types";

export function deployerFor(chainId: number): Address {
  return getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, assertSupportedChainId(chainId));
}

export function projectsFor(chainId: number): Address {
  return getJBContractAddress(JBCoreContracts.JBProjects, 6, assertSupportedChainId(chainId));
}

/** One immutable snapshot, salt and start time must be shared across all chains. */
export function buildDeployArgs(draft: MachineDraft, pitchUri: string, chainId: number, salt: Hex, startsAtOrAfter: number, cashOutTaxRate: 1000 | 3000 = CASH_OUT_TAX_RATE) {
  const chain=assertSupportedChainId(chainId);
  if (!draft.chainIds.includes(chain) || new Set(draft.chainIds).size !== draft.chainIds.length ||
    ![MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS].some(chains => draft.chainIds.every(id => chains.includes(id)))) {
    throw new Error("Deploy on distinct supported chains from one network environment.");
  }
  if(!isAddress(draft.address.trim())||draft.address.trim().toLowerCase()===zeroAddress)throw new Error("Enter a valid machine address.");
  if(!Number.isSafeInteger(startsAtOrAfter)||startsAtOrAfter<=0||startsAtOrAfter>=2**48)throw new Error("Invalid machine start time.");
  keepIndex(draft.keepPercent);
  const operator=draft.address.trim() as Address;
  const routes=draft.routes.filter(route=>route.machine.ids[chain]);
  if(draft.routes.some(route=>!Number.isInteger(route.percent)||route.percent<1||route.percent>100)||draft.routes.reduce((sum,route)=>sum+route.percent,0)>100)
    throw new Error("Plug ins can use at most 100% of the keep.");
  const routed=routes.reduce((sum,route)=>sum+route.percent,0);
  const splits=routes.map(route=>({
    percent:SPLITS_TOTAL_PERCENT*route.percent/100,
    projectId:BigInt(route.machine.ids[chain]),beneficiary:operator,preferAddToBalance:false,
    lockedUntil:route.locked?2**48-1:0,hook:zeroAddress,
  }));
  splits.push({percent:SPLITS_TOTAL_PERCENT*(100-routed)/100,projectId:0n,beneficiary:operator,preferAddToBalance:false,lockedUntil:0,hook:zeroAddress});
  const configuration={
    description:{name:draft.name.trim(),ticker:draft.id.trim().toUpperCase(),uri:pitchUri,salt},
    baseCurrency:USD_CURRENCY_ID(6),operator,scopeCashOutsToLocalBalances:false,
    stageConfigurations:[{
      startsAtOrAfter,autoIssuances:[],splitPercent:draft.keepPercent*100,splits,
      initialIssuance:BigInt(INITIAL_ISSUANCE_PER_USD)*10n**18n,
      issuanceCutFrequency:doublingFor(draft.doubling).days*86400,
      issuanceCutPercent:MAX_WEIGHT_CUT_PERCENT/2,cashOutTaxRate,extraMetadata:4,
    }],
  };
  const accountingContexts=[NATIVE_TOKEN,USDC_ADDRESSES[chain]].map(token=>({token,decimals:token===NATIVE_TOKEN?18:6,currency:Number(BigInt(token)&0xffffffffn)}));
  const suckers=draft.chainIds.length>1?parseSuckerDeployerConfig(chain,draft.chainIds.map(assertSupportedChainId),[MappableAsset.NATIVE,MappableAsset.USDC],{salt,version:6,bridge:"ccip"}):{deployerConfigurations:[],salt};
  // The SDK return type also includes older versions; require the V6 peer field.
  const v6Suckers={...suckers,deployerConfigurations:suckers.deployerConfigurations.map(config=>{
    if (!("peer" in config)) throw new Error("Expected V6 bridge configuration.");
    return config;
  })};
  const store={
    baseline721HookConfiguration:{
      name:`${configuration.description.name} Store`,symbol:`${configuration.description.ticker}STORE`,
      baseUri:"ipfs://",tokenUriResolver:zeroAddress,contractUri:pitchUri,
      tiersConfig:{tiers:[],currency:USD_CURRENCY_ID(6),decimals:6},
      flags:{noNewTiersWithReserves:false,noNewTiersWithVotes:false,noNewTiersWithOwnerMinting:false,preventOverspending:false},
    },
    salt,preventOperatorAdjustingTiers:false,preventOperatorUpdatingMetadata:false,
    preventOperatorMinting:false,preventOperatorIncreasingDiscountPercent:false,
  };
  // Explicit store configuration is required: the four-argument convenience
  // overload defaults to 18 price decimals instead of the machine's USD six.
  return [0n,configuration,accountingContexts,v6Suckers,store,[]] as const satisfies ContractFunctionArgs<typeof revDeployerAbi,"payable","deployFor">;
}

export function buildPitchUri(draft: MachineDraft, manual: string): string {
  const json=JSON.stringify({name:draft.name.trim(),description:draft.goal.trim(),manual});
  return `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
}

/** Read immutable saved terms; legacy 30% deployments must remain resumable. */
export function deploymentCashOutTaxRate(data: Hex): 1000 | 3000 {
  const decoded = decodeFunctionData({ abi: revDeployerAbi, data });
  if (decoded.functionName !== "deployFor") throw new Error("Invalid machine deployment.");
  const rate = decoded.args[1].stageConfigurations[0]?.cashOutTaxRate;
  if (rate !== 1000 && rate !== 3000) throw new Error("Unknown machine cash-out tax.");
  return rate;
}
