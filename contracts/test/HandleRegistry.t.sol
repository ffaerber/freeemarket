// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HandleRegistry} from "../src/HandleRegistry.sol";

/// @notice Exercises the ownerless handle registry: claim/resolve/release, the
///         one-handle-per-seller invariant, and charset/length validation.
contract HandleRegistryTest is Test {
    HandleRegistry internal reg;

    address internal seller = makeAddr("seller");
    address internal other = makeAddr("other");

    // Mirror of the contract's events for expectEmit assertions.
    event HandleClaimed(bytes32 indexed handleHash, string handle, address indexed seller);
    event HandleReleased(bytes32 indexed handleHash, address indexed seller);

    function setUp() public {
        reg = new HandleRegistry();
    }

    function _hash(string memory h) internal pure returns (bytes32) {
        return keccak256(bytes(h));
    }

    // --- claim ---

    function test_claim_setsStateAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit HandleClaimed(_hash("autoparts24"), "autoparts24", seller);

        vm.prank(seller);
        reg.claim("autoparts24");

        assertEq(reg.handleToSeller(_hash("autoparts24")), seller);
        assertEq(reg.sellerHandle(seller), "autoparts24");
        assertEq(reg.resolve("autoparts24"), seller);
    }

    function test_resolve_unclaimedIsZero() public view {
        assertEq(reg.resolve("nobody"), address(0));
    }

    function test_claim_idempotentForSameOwner() public {
        vm.startPrank(seller);
        reg.claim("shop1");
        reg.claim("shop1"); // re-claiming own handle is a no-op-ish success
        vm.stopPrank();
        assertEq(reg.resolve("shop1"), seller);
        assertEq(reg.sellerHandle(seller), "shop1");
    }

    function test_claim_revertsWhenTaken() public {
        vm.prank(seller);
        reg.claim("popular");

        vm.prank(other);
        vm.expectRevert(bytes("handle taken"));
        reg.claim("popular");
    }

    // --- changing handle frees the previous one ---

    function test_claim_changingHandleReleasesOld() public {
        vm.startPrank(seller);
        reg.claim("old-handle");

        // claiming a new handle releases the old one (event + state)
        vm.expectEmit(true, true, false, false);
        emit HandleReleased(_hash("old-handle"), seller);
        reg.claim("new-handle");
        vm.stopPrank();

        assertEq(reg.resolve("old-handle"), address(0), "old handle freed");
        assertEq(reg.resolve("new-handle"), seller);
        assertEq(reg.sellerHandle(seller), "new-handle");

        // freed handle is claimable by someone else
        vm.prank(other);
        reg.claim("old-handle");
        assertEq(reg.resolve("old-handle"), other);
    }

    // --- release ---

    function test_release_freesHandleAndEmits() public {
        vm.startPrank(seller);
        reg.claim("temp");

        vm.expectEmit(true, true, false, false);
        emit HandleReleased(_hash("temp"), seller);
        reg.release();
        vm.stopPrank();

        assertEq(reg.resolve("temp"), address(0));
        assertEq(reg.sellerHandle(seller), "");

        // reclaimable after release
        vm.prank(other);
        reg.claim("temp");
        assertEq(reg.resolve("temp"), other);
    }

    function test_release_revertsWhenNone() public {
        vm.prank(seller);
        vm.expectRevert(bytes("no handle"));
        reg.release();
    }

    // --- validation ---

    function test_claim_rejectsTooShort() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad length"));
        reg.claim("ab");
    }

    function test_claim_rejectsTooLong() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad length"));
        reg.claim("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); // 33 chars
    }

    function test_claim_rejectsUppercase() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad char"));
        reg.claim("AutoParts");
    }

    function test_claim_rejectsSpace() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad char"));
        reg.claim("auto parts");
    }

    function test_claim_rejectsLeadingHyphen() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad hyphen"));
        reg.claim("-shop");
    }

    function test_claim_rejectsTrailingHyphen() public {
        vm.prank(seller);
        vm.expectRevert(bytes("bad hyphen"));
        reg.claim("shop-");
    }

    function test_claim_acceptsHyphenAndDigitsInside() public {
        vm.prank(seller);
        reg.claim("a1-b2-c3");
        assertEq(reg.resolve("a1-b2-c3"), seller);
    }

    // --- fuzz: any all-lowercase-alnum string of 3..32 is accepted ---

    function testFuzz_claim_acceptsAlnum(uint256 len, uint256 seed) public {
        len = bound(len, 3, 32);
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            // map to [a-z0-9] deterministically (avoids hyphen edge cases)
            uint256 v = uint256(keccak256(abi.encode(seed, i))) % 36;
            b[i] = v < 10 ? bytes1(uint8(0x30 + v)) : bytes1(uint8(0x61 + (v - 10)));
        }
        string memory h = string(b);

        vm.prank(seller);
        reg.claim(h);
        assertEq(reg.resolve(h), seller);
    }
}
