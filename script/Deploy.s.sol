// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";

import {IREVDeployerMinimal, PluginDeployer} from "../src/PluginDeployer.sol";

/// @notice Deploys PluginDeployer on the current chain.
/// @dev Env: REV_DEPLOYER (the chain's REVDeployer), USDC (the chain's USDC).
///      forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $KEY
///      Use the same CREATE2 salt on every chain for a matching address.
contract Deploy is Script {
    bytes32 constant SALT = keccak256("plugin.money/deployer/v1");

    function run() external {
        address revDeployer = vm.envAddress("REV_DEPLOYER");
        address usdc = vm.envAddress("USDC");

        JBAccountingContext[] memory contexts = new JBAccountingContext[](2);
        // context currencies are token-keyed (uint32 of the token address), per protocol convention
        contexts[0] = JBAccountingContext({
            token: JBConstants.NATIVE_TOKEN,
            decimals: 18,
            currency: uint32(uint160(JBConstants.NATIVE_TOKEN))
        });
        contexts[1] = JBAccountingContext({token: usdc, decimals: 6, currency: uint32(uint160(usdc))});

        vm.startBroadcast();
        PluginDeployer deployer = new PluginDeployer{salt: SALT}(IREVDeployerMinimal(revDeployer), contexts);
        vm.stopBroadcast();

        console2.log("PluginDeployer:", address(deployer));
    }
}
