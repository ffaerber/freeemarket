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
 *  - `OWNER`  — the arbiter/owner (dispute resolver, allowlist curator).
 *               REQUIRED: the script reverts if unset. Must be the intended
 *               arbiter — it can never be renounced after deploy (see
 *               `resolveOwner`), so there is deliberately no implicit default.
 *
 *  There is NO platform fee: every order settles 100% from buyer to seller, and
 *  the contract has no fee rate, no fee accounting, and no owner withdrawal path
 *  (the operator earns nothing from facilitating trades — see CLAUDE.md §4).
 *
 *  ## Usage
 *
 *  `OWNER` is REQUIRED on every invocation (incl. dry runs) — set it to the
 *  intended arbiter (commonly the broadcasting EOA).
 *
 *  Dry run (no broadcast):
 *      OWNER=0xYourArbiter forge script script/Deploy.s.sol:Deploy
 *
 *  Deploy to Gnosis Chain (id 100):
 *      OWNER=0xYourArbiter \
 *      forge script script/Deploy.s.sol:Deploy \
 *        --rpc-url https://rpc.gnosischain.com \
 *        --private-key $PRIVATE_KEY --broadcast
 *
 *  With explicit token allowlist:
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

    /// @notice Owner/arbiter = the `OWNER` env address. REQUIRED — reverts if unset.
    ///
    ///         Why not default to `msg.sender`? In a `forge script`, code outside
    ///         `vm.startBroadcast()` runs as forge's DEFAULT_SENDER
    ///         (0x1804c8AB…1f38), NOT the broadcasting key — so a `msg.sender`
    ///         default silently bakes an address nobody controls into the owner
    ///         slot. That is catastrophic here: the arbiter can NEVER be renounced
    ///         (and ownership transfer must be initiated by the current owner), so
    ///         a wrong owner permanently bricks dispute resolution. Forcing an
    ///         explicit `OWNER` makes that mistake impossible. Set it to the
    ///         intended arbiter (commonly the broadcasting EOA).
    function resolveOwner() public view returns (address) {
        require(_isSet("OWNER"), "OWNER env required (intended arbiter; cannot be renounced after deploy)");
        return vm.envAddress("OWNER");
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
