/**
 * Para is optional. Without a usable key the connector is never added, so the
 * site still runs on injected wallets alone — an unconfigured deploy degrades
 * instead of shipping a sign-in button that can only fail.
 */
const PARA_ENVIRONMENTS = new Set(["DEV", "SANDBOX", "BETA", "PROD"]);

export const PARA_EMBEDDED_WALLET_ENABLED =
  (process.env.NEXT_PUBLIC_PARA_API_KEY?.trim().length ?? 0) >= 8 &&
  PARA_ENVIRONMENTS.has(process.env.NEXT_PUBLIC_PARA_ENV ?? "");
