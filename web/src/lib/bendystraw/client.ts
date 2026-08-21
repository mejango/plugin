"use client";

import type { BendystrawOperation } from "./operations";

/**
 * The browser sends an operation id and variables — never a GraphQL document.
 * The proxy resolves the document server-side.
 */
export async function queryBendystraw<T>(
  operation: BendystrawOperation,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch("/api/bendystraw/mainnet/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, variables }),
  });
  if (!res.ok) throw new Error(`bendystraw ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error("bendystraw returned no data");
  return body.data;
}
