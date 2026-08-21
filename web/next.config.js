/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // this app lives inside a larger repo; trace from here so standalone stays flat
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    // wagmi's connector barrel makes its vendor SDKs optional, which webpack can't
    // resolve; point it at the core package instead (same fix as revnet-money).
    config.resolve.alias["wagmi/connectors$"] = "@wagmi/core";
    return config;
  },
};
module.exports = nextConfig;
