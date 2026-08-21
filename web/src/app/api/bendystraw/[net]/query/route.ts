import { NextResponse } from "next/server";

import { bendystrawUrl } from "@/lib/bendystraw/endpoint.server";
import { isBendystrawOperation } from "@/lib/bendystraw/operations";
import { documentFor } from "@/lib/bendystraw/registry.server";

const TIMEOUT_MS = 15_000;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ errors: [{ message: "invalid json" }] }, { status: 400 });
  }

  const { operation, variables } = (payload ?? {}) as {
    operation?: unknown;
    variables?: unknown;
  };

  // Allow-list by id: an unknown or client-authored query never reaches the indexer.
  if (!isBendystrawOperation(operation)) {
    return NextResponse.json({ errors: [{ message: "unknown operation" }] }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(bendystrawUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: documentFor(operation),
        variables: (variables ?? {}) as Record<string, unknown>,
      }),
      signal: controller.signal,
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ errors: [{ message: "indexer unreachable" }] }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
