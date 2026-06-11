// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {HandleRegistry} from "../src/HandleRegistry.sol";

/**
 * @title DeployHandleRegistry
 * @notice Deploys the ownerless `HandleRegistry` (handle → seller alias for the
 *         multi-tenant storefront). Unlike `Deploy.s.sol`, there is NO config to
 *         resolve: the registry has no owner, no token list, and holds no funds.
 *
 *  ## Usage
 *
 *  Dry run (no broadcast):
 *      forge script script/DeployHandleRegistry.s.sol:DeployHandleRegistry
 *
 *  Deploy to Gnosis Chain (id 100):
 *      forge script script/DeployHandleRegistry.s.sol:DeployHandleRegistry \
 *        --rpc-url https://rpc.gnosischain.com \
 *        --private-key $PRIVATE_KEY --broadcast
 */
contract DeployHandleRegistry is Script {
    function run() external returns (HandleRegistry registry) {
        console2.log("== FreeeMarket HandleRegistry deploy ==");

        vm.startBroadcast();
        registry = new HandleRegistry();
        vm.stopBroadcast();

        console2.log("HandleRegistry deployed at:", address(registry));
    }
}
