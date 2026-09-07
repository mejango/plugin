# Machine deployment

The web form calls V6 `REVDeployer.deployFor` directly using the ABI and chain addresses from `@bananapus/nana-sdk-core`. It does not require a deployed `PluginDeployer` wrapper.

`web/src/lib/plugin/deploy.ts` builds the house configuration and explicit USD store configuration. The SDK supplies native/USDC accounting tokens and CCIP bridge configurations. One salt and start time are shared across the selected chains.

Before signing, the form checks deployer bytecode on every selected chain. Each transaction reads that chain’s live `JBProjects.creationFee()`, simulates the call, requests the wallet signature, and waits for a successful receipt. Failures stop the sequence and mark remaining chains skipped.

The Solidity wrapper and its deployment script remain as reference implementations. They are not part of the web deployment path.
