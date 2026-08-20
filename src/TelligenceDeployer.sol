// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBCurrencyIds} from "@bananapus/core-v6/src/libraries/JBCurrencyIds.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";

/// @notice The 4-arg `REVDeployer.deployFor` overload. Declared locally so this contract only depends on structs.
/// The hook return is decoded as a bare address; the selector matches since returns don't affect it.
interface IREVDeployerMinimal {
    function deployFor(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration
    )
        external
        payable
        returns (uint256, address);
}

/// @notice The machine's cut of issuance — the house offers three appetites.
enum TelligenceKeep {
    NONE, // 0% — keeps nothing
    A_BIT, // 3% — just a bit
    STANDARD, // 10% — the standard keep
    HUNGRY // 20% — hungry machine
}

/// @notice How often the issuance price doubles.
enum TelligenceDoubling {
    DAILY,
    WEEKLY,
    MONTHLY,
    QUARTERLY
}

/// @notice A machine, as its entrepreneur describes it: identity, the address that runs it, and its two dials.
/// @custom:member name The machine's name.
/// @custom:member id The machine's ID — its token's ticker.
/// @custom:member pitchUri The metadata URI holding the machine's pitch.
/// @custom:member machine The machine's address: receives the keep and operates the machine.
/// @custom:member keep The machine's cut of issuance. See `TelligenceKeep`.
/// @custom:member doubling How often the issuance price doubles. See `TelligenceDoubling`.
/// @custom:member startsAtOrAfter When the machine starts. Must be the SAME timestamp on every chain a machine
/// deploys to — it feeds the deterministic config hash — so the frontend picks one value (~10 minutes out, giving
/// every chain time to resolve) and passes it to each chain's deployment.
/// @custom:member salt Deployment salt — same machine + salt across chains gives matching addresses.
struct TelligenceMachine {
    string name;
    string id;
    string pitchUri;
    address payable machine;
    TelligenceKeep keep;
    TelligenceDoubling doubling;
    uint48 startsAtOrAfter;
    bytes32 salt;
}

/// @notice Starts telligence machines: revnets reduced to the two configs a machine sets — its keep and how fast its
/// issuance price doubles — with everything else locked to house rules.
/// @dev House rules: issuance priced in USD, one stage that runs forever, issuance halves
/// (price doubles) every doubling period, a 30% cash-out tax, all production splits to the machine, and the machine
/// as operator. Accounting contexts (which tokens back machines on this chain) are fixed at construction.
contract TelligenceDeployer {
    error TelligenceDeployer_NoMachine();
    error TelligenceDeployer_NoStartTime();

    /// @notice Cashing out pays a 30% tax that stays behind with the holders who stay.
    uint16 public constant CASH_OUT_TAX_RATE = 3000;

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
    /// @param machine The machine to start. See `TelligenceMachine`.
    /// @param suckers Cross-chain token bridge config; empty for a single-chain machine.
    /// @return revnetId The started machine's revnet ID.
    function startEngine(
        TelligenceMachine calldata machine,
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
            suckerDeploymentConfiguration: suckers
        });
    }

    /// @notice Build the full revnet config from a machine's two dials, filling the rest with house rules.
    function houseConfig(TelligenceMachine calldata machine)
        public
        pure
        returns (REVConfig memory configuration)
    {
        if (machine.machine == address(0)) revert TelligenceDeployer_NoMachine();
        if (machine.startsAtOrAfter == 0) revert TelligenceDeployer_NoStartTime();

        // The machine takes its whole keep.
        JBSplit[] memory splits = new JBSplit[](1);
        splits[0] = JBSplit({
            percent: JBConstants.SPLITS_TOTAL_PERCENT,
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
            extraMetadata: 0
        });

        configuration = REVConfig({
            description: REVDescription({name: machine.name, ticker: machine.id, uri: machine.pitchUri, salt: machine.salt}),
            baseCurrency: JBCurrencyIds.USD,
            operator: machine.machine,
            scopeCashOutsToLocalBalances: false,
            stageConfigurations: stages
        });
    }

    /// @notice The keep's split percent, out of 10,000.
    function keepPercent(TelligenceKeep keep) public pure returns (uint16) {
        if (keep == TelligenceKeep.NONE) return 0;
        if (keep == TelligenceKeep.A_BIT) return 300;
        if (keep == TelligenceKeep.STANDARD) return 1000;
        return 2000;
    }

    /// @notice The doubling cadence in seconds.
    function doublingSeconds(TelligenceDoubling doubling) public pure returns (uint32) {
        if (doubling == TelligenceDoubling.DAILY) return 1 days;
        if (doubling == TelligenceDoubling.WEEKLY) return 7 days;
        if (doubling == TelligenceDoubling.MONTHLY) return 30 days;
        return 90 days;
    }
}
