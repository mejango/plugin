/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // this app lives inside a larger repo; trace from here so standalone stays flat
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    // wagmi's connector barrel makes its vendor SDKs optional, which webpack can't
    // resolve; point it at the core package instead (same fix as revnet-money).
    // Exact-match only — our own code deep-imports `wagmi/connectors/injected`,
    // which has to keep resolving normally.
    config.resolve.alias["wagmi/connectors$"] = "@wagmi/core";
    // Para dynamically imports optional peers we do not use (Farcaster
    // mini-apps, Cosmos + Solana wallets, account abstraction); resolve them to
    // empty modules. Only the EVM connector is configured, so they never run.
    config.resolve.alias["@farcaster/miniapp-sdk"] = false;
    config.resolve.alias["@farcaster/miniapp-wagmi-connector"] = false;
    config.resolve.alias["@getpara/cosmos-wallet-connectors"] = false;
    config.resolve.alias["@getpara/evm-wallet-connectors"] = false;
    config.resolve.alias["@getpara/solana-wallet-connectors"] = false;
    config.resolve.alias["@x402/core"] = false;
    config.resolve.alias["@x402/evm"] = false;
    config.resolve.alias["@x402/svm"] = false;
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    for (const provider of [
      "alchemy",
      "biconomy",
      "cdp",
      "gelato",
      "pimlico",
      "porto",
      "rhinestone",
      "safe",
      "thirdweb",
      "zerodev",
    ]) {
      config.resolve.alias[`@getpara/aa-${provider}`] = false;
    }
    return config;
  },
};
module.exports = nextConfig;
