// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBCurrencyIds} from "@bananapus/core-v6/src/libraries/JBCurrencyIds.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";
import {IJB721TokenUriResolver} from "@bananapus/721-hook-v6/src/interfaces/IJB721TokenUriResolver.sol";
import {JB721InitTiersConfig} from "@bananapus/721-hook-v6/src/structs/JB721InitTiersConfig.sol";
import {JB721TierConfig} from "@bananapus/721-hook-v6/src/structs/JB721TierConfig.sol";
import {REV721TiersHookFlags} from "@rev-net/core-v6/src/structs/REV721TiersHookFlags.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVBaseline721HookConfig} from "@rev-net/core-v6/src/structs/REVBaseline721HookConfig.sol";
import {REVCroptopAllowedPost} from "@rev-net/core-v6/src/structs/REVCroptopAllowedPost.sol";
import {REVDeploy721TiersHookConfig} from "@rev-net/core-v6/src/structs/REVDeploy721TiersHookConfig.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";

/// @notice The 6-arg `REVDeployer.deployFor` overload. The 4-arg convenience overload self-deploys an empty 721
/// hook with 18 price decimals — wrong for a USD-priced machine — so the config is always ours to send.
/// The hook return is decoded as a bare address; the selector matches since returns don't affect it.
interface IREVDeployerMinimal {
    function deployFor(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration,
        REVDeploy721TiersHookConfig calldata tiered721HookConfiguration,
        REVCroptopAllowedPost[] calldata allowedPosts
    )
        external
        payable
        returns (uint256, address);
}

/// @notice The machine's cut of issuance — the house menu of appetites.
enum PluginKeep {
    NONE, // 0% — keeps nothing
    A_BIT, // 10% — just a bit
    A_GOOD_BIT, // 32% — a good bit
    HALF, // 50% — half and half
    THE_BULK, // 68% — the bulk of it
    ALL_BUT_A_BIT // 90% — all but a bit
}

/// @notice How often the issuance price doubles.
enum PluginDoubling {
    DAILY,
    WEEKLY,
    MONTHLY,
    QUARTERLY
}

/// @notice A slice of the keep routed to another Juicebox project on this chain.
/// @dev The frontend resolves the per-chain twin ID for omnichain projects; each chain's deployment carries its own.
/// @custom:member projectId The local-chain ID of the project this route pays.
/// @custom:member percentOfKeep How much of the keep flows there, out of 100.
/// @custom:member locked If true, the route is locked forever — no operator can ever repoint or remove it.
struct PluginRoute {
    uint64 projectId;
    uint16 percentOfKeep;
    bool locked;
}

/// @notice A machine, as its entrepreneur describes it: identity, the address that runs it, and its two dials.
/// @custom:member name The machine's name.
/// @custom:member id The machine's ID — its token's ticker.
/// @custom:member pitchUri The metadata URI holding the machine's pitch.
/// @custom:member machine The machine's address: receives the keep and operates the machine.
/// @custom:member keep The machine's cut of issuance. See `PluginKeep`.
/// @custom:member doubling How often the issuance price doubles. See `PluginDoubling`.
/// @custom:member startsAtOrAfter When the machine starts. Must be the SAME timestamp on every chain a machine
/// deploys to — it feeds the deterministic config hash — so the frontend picks one value (~10 minutes out, giving
/// every chain time to resolve) and passes it to each chain's deployment.
/// @custom:member salt Deployment salt — same machine + salt across chains gives matching addresses.
/// @custom:member routes Slices of the keep routed to other projects. The machine's address is always the
/// beneficiary of every route — whatever tokens the routed project mints come back to the machine.
struct PluginMachine {
    string name;
    string id;
    string pitchUri;
    address payable machine;
    PluginKeep keep;
    PluginDoubling doubling;
    uint48 startsAtOrAfter;
    bytes32 salt;
    PluginRoute[] routes;
}

/// @notice Starts plugin machines: revnets reduced to the two configs a machine sets — its keep and how fast its
/// issuance price doubles — with everything else locked to house rules.
/// @dev House rules: issuance priced in USD, one stage that runs forever, issuance halves
/// (price doubles) every doubling period, a 30% cash-out tax, all production splits to the machine, and the machine
/// as operator. Accounting contexts (which tokens back machines on this chain) are fixed at construction.
contract PluginDeployer {
    error PluginDeployer_NoMachine();
    error PluginDeployer_NoStartTime();
    error PluginDeployer_RoutesExceedKeep(uint256 totalPercent);

    /// @notice Cashing out pays a 30% tax that stays behind with the holders who stay.
    uint16 public constant CASH_OUT_TAX_RATE = 3000;

    /// @notice Stage metadata bit that lets suckers deploy — required for omnichain machines.
    uint16 public constant ALLOW_SUCKER_DEPLOYMENT = 1 << 2;

    /// @notice Tokens issued per USD when a machine starts. Doublings scale the price from here.
    uint112 public constant INITIAL_ISSUANCE = 1000e18;

    /// @notice Each doubling period, issuance halves — the price to issue doubles.
    uint32 public constant ISSUANCE_HALVING = uint32(JBConstants.MAX_WEIGHT_CUT_PERCENT / 2);

    /// @notice The revnet deployer every machine runs on.
    IREVDeployerMinimal public immutable REV_DEPLOYER;

    /// @notice The tokens that back machines on this chain (ETH and USDC).
    JBAccountingContext[] internal _accountingContexts;

    constructor(IREVDeployerMinimal revDeployer, JBAccountingContext[] memory accountingContexts) {
        REV_DEPLOYER = revDeployer;
        for (uint256 i; i < accountingContexts.length; i++) {
            _accountingContexts.push(accountingContexts[i]);
        }
    }

    /// @notice The tokens that back machines on this chain.
    function accountingContexts() external view returns (JBAccountingContext[] memory) {
        return _accountingContexts;
    }

    /// @notice Start a machine.
    /// @param machine The machine to start. See `PluginMachine`.
    /// @param suckers Cross-chain token bridge config; empty for a single-chain machine.
    /// @return revnetId The started machine's revnet ID.
    function startEngine(
        PluginMachine calldata machine,
        REVSuckerDeploymentConfig calldata suckers
    )
        external
        payable
        returns (uint256 revnetId)
    {
        (revnetId,) = REV_DEPLOYER.deployFor{value: msg.value}({
            revnetId: 0,
            configuration: houseConfig(machine),
            accountingContextsToAccept: _accountingContexts,
            suckerDeploymentConfiguration: suckers,
            tiered721HookConfiguration: storeConfig(machine),
            allowedPosts: new REVCroptopAllowedPost[](0)
        });
    }

    /// @notice Build the full revnet config from a machine's two dials, filling the rest with house rules.
    function houseConfig(PluginMachine calldata machine)
        public
        pure
        returns (REVConfig memory configuration)
    {
        if (machine.machine == address(0)) revert PluginDeployer_NoMachine();
        if (machine.startsAtOrAfter == 0) revert PluginDeployer_NoStartTime();

        // The keep splits between the machine and its routes. The machine's address is
        // ALWAYS the beneficiary — routed projects mint their tokens back to the machine.
        uint256 numberOfRoutes = machine.routes.length;
        JBSplit[] memory splits = new JBSplit[](numberOfRoutes + 1);
        uint256 routedPercent;
        for (uint256 i; i < numberOfRoutes; i++) {
            PluginRoute calldata route = machine.routes[i];
            routedPercent += route.percentOfKeep;
            splits[i] = JBSplit({
                percent: uint32((uint256(JBConstants.SPLITS_TOTAL_PERCENT) * route.percentOfKeep) / 100),
                projectId: route.projectId,
                beneficiary: machine.machine,
                preferAddToBalance: false,
                lockedUntil: route.locked ? type(uint48).max : 0,
                hook: IJBSplitHook(address(0))
            });
        }
        if (routedPercent > 100) revert PluginDeployer_RoutesExceedKeep(routedPercent);
        // The machine takes whatever the routes leave behind.
        splits[numberOfRoutes] = JBSplit({
            percent: uint32(JBConstants.SPLITS_TOTAL_PERCENT - (uint256(JBConstants.SPLITS_TOTAL_PERCENT) * routedPercent) / 100),
            projectId: 0,
            beneficiary: machine.machine,
            preferAddToBalance: false,
            lockedUntil: 0,
            hook: IJBSplitHook(address(0))
        });

        // One stage, starts when every chain is ready, runs forever.
        REVStageConfig[] memory stages = new REVStageConfig[](1);
        stages[0] = REVStageConfig({
            startsAtOrAfter: machine.startsAtOrAfter,
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: keepPercent(machine.keep),
            splits: splits,
            initialIssuance: INITIAL_ISSUANCE,
            issuanceCutFrequency: doublingSeconds(machine.doubling),
            issuanceCutPercent: ISSUANCE_HALVING,
            cashOutTaxRate: CASH_OUT_TAX_RATE,
            extraMetadata: ALLOW_SUCKER_DEPLOYMENT
        });

        configuration = REVConfig({
            description: REVDescription({name: machine.name, ticker: machine.id, uri: machine.pitchUri, salt: machine.salt}),
            baseCurrency: JBCurrencyIds.USD,
            operator: machine.machine,
            scopeCashOutsToLocalBalances: false,
            stageConfigurations: stages
        });
    }

    /// @notice An empty, correctly USD-priced store for the machine. The operator can stock it later.
    function storeConfig(PluginMachine calldata machine) public pure returns (REVDeploy721TiersHookConfig memory) {
        return REVDeploy721TiersHookConfig({
            baseline721HookConfiguration: REVBaseline721HookConfig({
                name: string.concat(machine.name, " Store"),
                symbol: string.concat(machine.id, "STORE"),
                baseUri: "ipfs://",
                tokenUriResolver: IJB721TokenUriResolver(address(0)),
                contractUri: machine.pitchUri,
                tiersConfig: JB721InitTiersConfig({
                    tiers: new JB721TierConfig[](0),
                    currency: JBCurrencyIds.USD,
                    decimals: 6
                }),
                flags: REV721TiersHookFlags({
                    noNewTiersWithReserves: false,
                    noNewTiersWithVotes: false,
                    noNewTiersWithOwnerMinting: false,
                    preventOverspending: false
                })
            }),
            salt: machine.salt,
            preventOperatorAdjustingTiers: false,
            preventOperatorUpdatingMetadata: false,
            preventOperatorMinting: false,
            preventOperatorIncreasingDiscountPercent: false
        });
    }

    /// @notice The keep's split percent, out of 10,000.
    function keepPercent(PluginKeep keep) public pure returns (uint16) {
        if (keep == PluginKeep.NONE) return 0;
        if (keep == PluginKeep.A_BIT) return 1000;
        if (keep == PluginKeep.A_GOOD_BIT) return 3200;
        if (keep == PluginKeep.HALF) return 5000;
        if (keep == PluginKeep.THE_BULK) return 6800;
        return 9000;
    }

    /// @notice The doubling cadence in seconds.
    function doublingSeconds(PluginDoubling doubling) public pure returns (uint32) {
        if (doubling == PluginDoubling.DAILY) return 1 days;
        if (doubling == PluginDoubling.WEEKLY) return 7 days;
        if (doubling == PluginDoubling.MONTHLY) return 30 days;
        return 90 days;
    }
}
