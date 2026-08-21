# Deploying TelligenceDeployer

One command per chain. REVDeployer v6 is the same address everywhere; USDC differs.

```bash
export KEY=<funded deployer key>
export REV_DEPLOYER=0xb552eb94284f94b833837d4b2cbb237128415d4e

# Ethereum
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 forge script script/Deploy.s.sol --rpc-url https://eth.llamarpc.com --broadcast --private-key $KEY
# Base
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 forge script script/Deploy.s.sol --rpc-url https://mainnet.base.org --broadcast --private-key $KEY
# Optimism
USDC=0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 forge script script/Deploy.s.sol --rpc-url https://mainnet.optimism.io --broadcast --private-key $KEY
# Arbitrum
USDC=0xaf88d065e77c8cC2239327C5EDb3A432268e5831 forge script script/Deploy.s.sol --rpc-url https://arb1.arbitrum.io/rpc --broadcast --private-key $KEY
```

CREATE2 salt is fixed, so the address matches across chains. After deploying,
paste the address into `TELLIGENCE_DEPLOYER` in create.html.

Machine deploys send `JBProjects.creationFee()` as value (read live by the page).
