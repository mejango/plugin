import "server-only";

import { BendystrawOperations, type BendystrawOperation } from "./operations";

/**
 * Server-only GraphQL documents, keyed by operation id. Adding a query here is
 * the only way to expose one — the proxy refuses ids it doesn't find.
 */
const DOCUMENTS: Record<BendystrawOperation, string> = {
  [BendystrawOperations.TrendingMachines]: `
    query TrendingMachines {
      suckerGroups(where: { version: 6, trendingScore_gt: "0" }, orderBy: "trendingScore", orderDirection: "desc", limit: 6) {
        items {
          id
          projects(limit: 20, orderBy: "chainId", orderDirection: "asc") {
            items {
              projectId chainId name balance tokenSymbol decimals currency
              deployErc20Events(limit: 1, orderBy: "timestamp", orderDirection: "desc") { items { symbol } }
            }
          }
        }
      }
    }
  `,
  [BendystrawOperations.TopMachines]: `
    query TopMachines {
      suckerGroups(where: { version: 6 }, orderBy: "balanceUsd", orderDirection: "desc", limit: 6) {
        items {
          id
          projects(limit: 20, orderBy: "chainId", orderDirection: "asc") {
            items {
              projectId chainId name balance tokenSymbol decimals currency
              deployErc20Events(limit: 1, orderBy: "timestamp", orderDirection: "desc") { items { symbol } }
            }
          }
        }
      }
    }
  `,
  [BendystrawOperations.NewMachines]: `
    query NewMachines {
      suckerGroups(where: { version: 6 }, orderBy: "createdAt", orderDirection: "desc", limit: 6) {
        items {
          id
          projects(limit: 20, orderBy: "chainId", orderDirection: "asc") {
            items {
              projectId chainId name balance tokenSymbol decimals currency
              deployErc20Events(limit: 1, orderBy: "timestamp", orderDirection: "desc") { items { symbol } }
            }
          }
        }
      }
    }
  `,
  [BendystrawOperations.LatestMachines]: `
    query LatestMachines {
      activityEvents(where: { version: 6, OR: [
        { payEvent_not: null }, { cashOutTokensEvent_not: null }, { swapEvent_not: null },
        { sendPayoutsEvent_not: null }, { rulesetQueuedEvent_not: null },
        { projectCreateEvent_not: null }, { addToBalanceEvent_not: null }
      ] }, orderBy: "timestamp", orderDirection: "desc", limit: 6) {
        items {
          id projectId timestamp project { name }
          payEvent { amount } cashOutTokensEvent { reclaimAmount }
          swapEvent { direction } sendPayoutsEvent { amount }
          rulesetQueuedEvent { cycleNumber } projectCreateEvent { from }
          addToBalanceEvent { amount }
        }
      }
    }
  `,
  [BendystrawOperations.SearchProjects]: `
    query SearchProjects($where: projectFilter!, $limit: Int) {
      projects(where: $where, orderBy: "volume", orderDirection: "desc", limit: $limit) {
        items { projectId chainId suckerGroupId name logoUri tokenSymbol decimals isRevnet version deployErc20Events(limit: 1, orderBy: "timestamp", orderDirection: "desc") { items { symbol } } }
      }
    }
  `,
  [BendystrawOperations.SuckerGroup]: `
    query SuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        id
        projects { items { chainId projectId tokenSymbol decimals balance tokenSupply } }
      }
    }
  `,
  [BendystrawOperations.Project]: `
    query Project($projectId: Int!, $chainId: Int!) {
      project(projectId: $projectId, chainId: $chainId, version: 6) {
        projectId chainId suckerGroupId name handle logoUri projectTagline
        tokenSymbol decimals currency isRevnet owner metadataUri createdAt
        balance volume volumeUsd tokenSupply paymentsCount contributorsCount
      }
    }
  `,
};

export function documentFor(operation: BendystrawOperation): string {
  return DOCUMENTS[operation];
}
