// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Marketplace} from "../src/Marketplace.sol";

/**
 * @title Deploy
 * @notice Deploys the shared `Marketplace` escrow contract and seeds its
 *         accepted-token allowlist (CLAUDE.md build step #4).
 *
 *  The contract is multi-token: the owner curates an allowlist of ERC-20s, and
 *  each listing picks one of them to be priced/settled in. This script seeds
 *  that initial allowlist at construction. No single token is hardcoded into the
 *  contract; the choice lives here (and can be changed later via
 *  `setTokenAccepted`).
 *
 *  ## Configuration (all optional — sensible Gnosis defaults)
 *
 *  - `TOKENS` — comma-separated ERC-20 addresses to seed the allowlist with.
 *               Defaults to Gnosis WXDAI + bridged USDC (see constants).
 *  - `OWNER`  — the arbiter/owner (dispute resolver, fee withdrawer, allowlist
 *               curator). Defaults to the broadcasting address.
 *
 *  The platform fee starts at 0; the owner sets it post-deploy via `setFeeBps`
 *  (it is owner-gated, so the deployer can't set it for a separate arbiter).
 *
 *  ## Usage
 *
 *  Dry run (no broadcast):
 *      forge script script/Deploy.s.sol:Deploy
 *
 *  Deploy to Gnosis Chain (id 100):
 *      forge script script/Deploy.s.sol:Deploy \
 *        --rpc-url https://rpc.gnosischain.com \
 *        --private-key $PRIVATE_KEY --broadcast
 *
 *  With explicit config:
 *      TOKENS=0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d \
 *      OWNER=0xYourArbiter \
 *      forge script script/Deploy.s.sol:Deploy --rpc-url ... --broadcast
 */
contract Deploy is Script {
    // --- Canonical Gnosis Chain (id 100) token addresses ---
    // WXDAI: wrapped native xDAI — 18 decimals, deeply liquid, no bridge dependency.
    address internal constant GNOSIS_WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    // USDC: bridged to Gnosis via the Omnibridge — 6 decimals.
    address internal constant GNOSIS_USDC = 0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83;
    // USDC.e: Circle-issued USDC bridged via Stargate — 6 decimals. Provided as a
    // documented option; not in the default set to avoid over-seeding.
    address internal constant GNOSIS_USDCE = 0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0;

    /// @notice Resolve config from env, then deploy.
    function run() external returns (Marketplace market) {
        return deploy(resolveOwner(), resolveTokens());
    }

    /// @notice Deploy with explicit config (env-free). Broadcasts the creation tx.
    function deploy(address owner, address[] memory tokens) public returns (Marketplace market) {
        _logPlan(owner, tokens);

        vm.startBroadcast();
        market = new Marketplace(tokens, owner);
        vm.stopBroadcast();

        console2.log("Marketplace deployed at:", address(market));
    }

    /// @notice Owner = `OWNER` env if set (and non-empty), else the broadcasting address.
    function resolveOwner() public view returns (address) {
        if (_isSet("OWNER")) {
            return vm.envAddress("OWNER");
        }
        return msg.sender;
    }

    /// @notice Tokens = `TOKENS` env (comma-separated) if set (and non-empty),
    ///         else Gnosis WXDAI + USDC.
    function resolveTokens() public view returns (address[] memory) {
        if (_isSet("TOKENS")) {
            return vm.envAddress("TOKENS", ",");
        }
        address[] memory defaults = new address[](2);
        defaults[0] = GNOSIS_WXDAI;
        defaults[1] = GNOSIS_USDC;
        return defaults;
    }

    /// @dev True when an env var is present AND non-empty. Treating empty as
    ///      "unset" keeps `KEY=` (and test `vm.setEnv(key, "")`) from clobbering
    ///      the defaults, which `vm.envOr` would otherwise parse as a real value.
    function _isSet(string memory key) internal view returns (bool) {
        return bytes(vm.envOr(key, string(""))).length > 0;
    }

    function _logPlan(address owner, address[] memory tokens) internal pure {
        console2.log("== FreeMarket Marketplace deploy ==");
        console2.log("owner  :", owner);
        console2.log("tokens :", tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            console2.log("  -", tokens[i]);
        }
    }
}
