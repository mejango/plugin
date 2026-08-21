import "server-only";

import { BendystrawOperations, type BendystrawOperation } from "./operations";

/**
 * Server-only GraphQL documents, keyed by operation id. Adding a query here is
 * the only way to expose one — the proxy refuses ids it doesn't find.
 */
const DOCUMENTS: Record<BendystrawOperation, string> = {
  [BendystrawOperations.SearchProjects]: `
    query SearchProjects($where: projectFilter!, $limit: Int) {
      projects(where: $where, orderBy: "volume", orderDirection: "desc", limit: $limit) {
        items { projectId chainId suckerGroupId name tokenSymbol decimals isRevnet version }
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
