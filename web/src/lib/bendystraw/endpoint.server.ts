import "server-only";

/**
 * One canonical endpoint, overridable per environment. Mainnet-only for now;
 * add the testnet split here when plugin supports test chains.
 */
export function bendystrawUrl(): string {
  const base = process.env.NEXT_PUBLIC_BENDYSTRAW_URL ?? "https://bendystraw.up.railway.app";
  const url = new URL(base);
  // Strip any credentials a misconfigured env might carry, and normalize the path.
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/graphql")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/graphql`;
  }
  return url.toString();
}
