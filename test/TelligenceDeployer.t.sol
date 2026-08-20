// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBCurrencyIds} from "@bananapus/core-v6/src/libraries/JBCurrencyIds.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";

import {
    IREVDeployerMinimal,
    TelligenceDeployer,
    TelligenceDoubling,
    TelligenceKeep,
    TelligenceMachine,
    TelligenceRoute
} from "../src/TelligenceDeployer.sol";

contract MockREVDeployer is IREVDeployerMinimal {
    uint256 public receivedValue;
    uint256 public receivedRevnetId = type(uint256).max;
    address public receivedOperator;
    uint256 public accountingContextCount;

    function deployFor(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata
    )
        external
        payable
        returns (uint256, address)
    {
        receivedValue = msg.value;
        receivedRevnetId = revnetId;
        receivedOperator = configuration.operator;
        accountingContextCount = accountingContextsToAccept.length;
        return (42, address(0));
    }
}

contract TelligenceDeployerTest is Test {
    MockREVDeployer internal mock;
    TelligenceDeployer internal deployer;
    address payable internal machineAddress = payable(address(0xBEEF));

    function setUp() public {
        mock = new MockREVDeployer();
        JBAccountingContext[] memory contexts = new JBAccountingContext[](2);
        contexts[0] = JBAccountingContext({token: JBConstants.NATIVE_TOKEN, decimals: 18, currency: JBCurrencyIds.ETH});
        contexts[1] =
            JBAccountingContext({token: address(0xdAC0), decimals: 6, currency: uint32(uint160(address(0xdAC0)))});
        deployer = new TelligenceDeployer(mock, contexts);
    }

    function _machine(TelligenceKeep keep, TelligenceDoubling doubling) internal view returns (TelligenceMachine memory) {
        return TelligenceMachine({
            name: "Foraging Bot",
            id: "FORAGE",
            pitchUri: "ipfs://pitch",
            machine: machineAddress,
            keep: keep,
            doubling: doubling,
            startsAtOrAfter: uint48(1_800_000_000),
            salt: bytes32("salt"),
            routes: new TelligenceRoute[](0)
        });
    }

    function _emptySuckers() internal pure returns (REVSuckerDeploymentConfig memory config) {}

    function test_houseConfigAppliesHouseRules() public view {
        REVConfig memory config = deployer.houseConfig(_machine(TelligenceKeep.STANDARD, TelligenceDoubling.WEEKLY));

        assertEq(config.baseCurrency, JBCurrencyIds.USD);
        assertEq(config.operator, machineAddress);
        assertFalse(config.scopeCashOutsToLocalBalances);
        assertEq(config.description.name, "Foraging Bot");
        assertEq(config.description.ticker, "FORAGE");
        assertEq(config.stageConfigurations.length, 1);
        assertEq(config.stageConfigurations[0].startsAtOrAfter, uint48(1_800_000_000));
        assertEq(config.stageConfigurations[0].splitPercent, 1000);
        assertEq(config.stageConfigurations[0].issuanceCutFrequency, 7 days);
        assertEq(config.stageConfigurations[0].issuanceCutPercent, JBConstants.MAX_WEIGHT_CUT_PERCENT / 2);
        assertEq(config.stageConfigurations[0].cashOutTaxRate, 3000);
        assertEq(config.stageConfigurations[0].splits.length, 1);
        assertEq(config.stageConfigurations[0].splits[0].beneficiary, machineAddress);
        assertEq(config.stageConfigurations[0].splits[0].percent, JBConstants.SPLITS_TOTAL_PERCENT);
    }

    function test_startEngineForwardsToREVDeployer() public {
        uint256 revnetId = deployer.startEngine{value: 0.01 ether}(_machine(TelligenceKeep.HUNGRY, TelligenceDoubling.DAILY), _emptySuckers());

        assertEq(revnetId, 42);
        assertEq(mock.receivedValue(), 0.01 ether);
        assertEq(mock.receivedRevnetId(), 0);
        assertEq(mock.receivedOperator(), machineAddress);
        assertEq(mock.accountingContextCount(), 2);
    }

    function test_enumMappings() public view {
        assertEq(deployer.keepPercent(TelligenceKeep.NONE), 0);
        assertEq(deployer.keepPercent(TelligenceKeep.A_BIT), 300);
        assertEq(deployer.keepPercent(TelligenceKeep.STANDARD), 1000);
        assertEq(deployer.keepPercent(TelligenceKeep.HUNGRY), 2000);
        assertEq(deployer.doublingSeconds(TelligenceDoubling.DAILY), 1 days);
        assertEq(deployer.doublingSeconds(TelligenceDoubling.WEEKLY), 7 days);
        assertEq(deployer.doublingSeconds(TelligenceDoubling.MONTHLY), 30 days);
        assertEq(deployer.doublingSeconds(TelligenceDoubling.QUARTERLY), 90 days);
    }

    function test_routesSplitTheKeepWithMachineAsBeneficiary() public view {
        TelligenceMachine memory m = _machine(TelligenceKeep.STANDARD, TelligenceDoubling.WEEKLY);
        m.routes = new TelligenceRoute[](2);
        m.routes[0] = TelligenceRoute({projectId: 3, percentOfKeep: 10, locked: true});
        m.routes[1] = TelligenceRoute({projectId: 4, percentOfKeep: 25, locked: false});
        REVConfig memory config = deployer.houseConfig(m);

        assertEq(config.stageConfigurations[0].splits.length, 3);
        assertEq(config.stageConfigurations[0].splits[0].projectId, 3);
        assertEq(config.stageConfigurations[0].splits[0].percent, uint32(uint256(JBConstants.SPLITS_TOTAL_PERCENT) * 10 / 100));
        assertEq(config.stageConfigurations[0].splits[0].beneficiary, machineAddress);
        assertEq(config.stageConfigurations[0].splits[0].lockedUntil, type(uint48).max);
        assertEq(config.stageConfigurations[0].splits[1].projectId, 4);
        assertEq(config.stageConfigurations[0].splits[1].lockedUntil, 0);
        assertEq(config.stageConfigurations[0].splits[1].beneficiary, machineAddress);
        assertEq(config.stageConfigurations[0].splits[2].projectId, 0);
        assertEq(config.stageConfigurations[0].splits[2].percent, uint32(uint256(JBConstants.SPLITS_TOTAL_PERCENT) * 65 / 100));
        assertEq(config.stageConfigurations[0].splits[2].beneficiary, machineAddress);
    }

    function test_revertsWhenRoutesExceedKeep() public {
        TelligenceMachine memory m = _machine(TelligenceKeep.STANDARD, TelligenceDoubling.WEEKLY);
        m.routes = new TelligenceRoute[](2);
        m.routes[0] = TelligenceRoute({projectId: 3, percentOfKeep: 60, locked: false});
        m.routes[1] = TelligenceRoute({projectId: 4, percentOfKeep: 41, locked: false});
        vm.expectRevert(abi.encodeWithSelector(TelligenceDeployer.TelligenceDeployer_RoutesExceedKeep.selector, 101));
        deployer.houseConfig(m);
    }

    function test_revertsOnBadInputs() public {
        TelligenceMachine memory noMachine = _machine(TelligenceKeep.NONE, TelligenceDoubling.DAILY);
        noMachine.machine = payable(address(0));
        vm.expectRevert(TelligenceDeployer.TelligenceDeployer_NoMachine.selector);
        deployer.houseConfig(noMachine);

        TelligenceMachine memory noStart = _machine(TelligenceKeep.NONE, TelligenceDoubling.DAILY);
        noStart.startsAtOrAfter = 0;
        vm.expectRevert(TelligenceDeployer.TelligenceDeployer_NoStartTime.selector);
        deployer.houseConfig(noStart);
    }
}
