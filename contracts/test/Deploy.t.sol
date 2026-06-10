// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @notice Exercises the deploy script: env-based config resolution and the
///         resulting on-chain state (seeded allowlist, owner).
///
/// @dev `vm.setEnv` mutates process-global state and forge runs test functions
///      in parallel, so env-dependent assertions are confined to ONE test
///      (`test_configResolution`). The deployment-state tests call the env-free
///      `deploy(owner, tokens)` overload, so they never touch env and can't race.
contract DeployTest is Test {
    Deploy internal deployer;

    address internal constant GNOSIS_WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address internal constant GNOSIS_USDC = 0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83;

    function setUp() public {
        deployer = new Deploy();
    }

    // --- env config resolution (single race-free test) ---

    function test_configResolution() public {
        // defaults: empty env == unset
        vm.setEnv("TOKENS", "");
        vm.setEnv("OWNER", "");

        address[] memory tokens = deployer.resolveTokens();
        assertEq(tokens.length, 2, "default token count");
        assertEq(tokens[0], GNOSIS_WXDAI, "default token[0] = WXDAI");
        assertEq(tokens[1], GNOSIS_USDC, "default token[1] = USDC");

        // OWNER is REQUIRED: unset must revert (never silently default to a
        // forge-default-sender address — that would brick the un-renounceable arbiter).
        vm.expectRevert(bytes("OWNER env required (intended arbiter; cannot be renounced after deploy)"));
        deployer.resolveOwner();

        // TOKENS override (comma-separated)
        vm.setEnv("TOKENS", "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222");
        address[] memory custom = deployer.resolveTokens();
        assertEq(custom.length, 2, "override token count");
        assertEq(custom[0], 0x1111111111111111111111111111111111111111, "override token[0]");
        assertEq(custom[1], 0x2222222222222222222222222222222222222222, "override token[1]");

        // OWNER override
        address arbiter = makeAddr("arbiter");
        vm.setEnv("OWNER", vm.toString(arbiter));
        assertEq(deployer.resolveOwner(), arbiter, "override owner");
    }

    // --- deployment state (env-free) ---

    function test_deploy_seedsAllowlistAndSetsOwner() public {
        address arbiter = makeAddr("arbiter");
        address[] memory tokens = new address[](2);
        tokens[0] = GNOSIS_WXDAI;
        tokens[1] = GNOSIS_USDC;

        Marketplace market = deployer.deploy(arbiter, tokens);

        assertEq(market.owner(), arbiter);
        assertTrue(market.acceptedTokens(GNOSIS_WXDAI));
        assertTrue(market.acceptedTokens(GNOSIS_USDC));
        assertFalse(market.acceptedTokens(makeAddr("random")));
    }

    function test_deploy_seedsExactlyTheGivenTokens() public {
        address tokenA = makeAddr("tokenA");
        address tokenB = makeAddr("tokenB");
        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        Marketplace market = deployer.deploy(makeAddr("arbiter"), tokens);

        assertTrue(market.acceptedTokens(tokenA));
        assertTrue(market.acceptedTokens(tokenB));
        assertFalse(market.acceptedTokens(GNOSIS_WXDAI));
    }

    function test_deploy_revertsOnZeroToken() public {
        // The constructor rejects address(0) in the seed set.
        address[] memory tokens = new address[](1);
        tokens[0] = address(0);
        vm.expectRevert(bytes("token=0"));
        deployer.deploy(makeAddr("arbiter"), tokens);
    }
}
