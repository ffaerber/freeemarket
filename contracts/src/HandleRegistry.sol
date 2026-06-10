// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HandleRegistry
 * @notice A permissionless, ownerless registry mapping a human-readable handle
 *         (e.g. "autoparts24") to a seller address, so a single multi-tenant
 *         storefront can resolve `freeemarket.eth.limo/<handle>` → seller and
 *         render that shop (CLAUDE.md: multi-tenant storefront).
 *
 *  This contract holds NO funds and has NO owner/admin: handles are claimed
 *  first-come by sellers themselves, fully on-chain. It is intentionally
 *  decoupled from the escrow `Marketplace` (which keys shops/listings by seller
 *  ADDRESS) — a handle is just an alias for an address, so every downstream read
 *  already works once a handle resolves.
 *
 * @dev One ACTIVE handle per seller (and one seller per handle). Claiming a new
 *      handle frees the caller's previous one. Handles are stored verbatim and
 *      indexed by `keccak256(bytes(handle))`; the charset is constrained so the
 *      hash key is canonical (no case/whitespace ambiguity) and the handle is
 *      URL-safe. This contract is unaudited, but ownerless + fund-free, so its
 *      blast radius is limited to handle squatting.
 */
contract HandleRegistry {
    // --- Storage ---

    /// @notice handle hash (keccak256 of the lowercase handle bytes) → seller.
    ///         `address(0)` means the handle is free.
    mapping(bytes32 => address) public handleToSeller;

    /// @notice seller → their current handle (empty string = none). Reverse
    ///         lookup so a storefront/CMS can show "your handle" for an address.
    mapping(address => string) public sellerHandle;

    // --- Events ---

    /// @notice Emitted when `seller` claims `handle`. `handleHash` is indexed for
    ///         cheap lookups; the plaintext `handle` rides in the data.
    event HandleClaimed(bytes32 indexed handleHash, string handle, address indexed seller);

    /// @notice Emitted when a seller's handle is freed (via `release`, or because
    ///         the seller claimed a different handle).
    event HandleReleased(bytes32 indexed handleHash, address indexed seller);

    // --- Handles ---

    /// @notice Claim `handle` for the caller. Validates the charset/length, then
    ///         requires the handle is free (or already the caller's). If the
    ///         caller already holds a DIFFERENT handle, it is released first, so a
    ///         seller never holds two handles at once.
    /// @param handle lowercase a-z / 0-9 / '-', length 3–32, no leading/trailing '-'.
    function claim(string calldata handle) external {
        _validate(handle);
        bytes32 hash = keccak256(bytes(handle));

        address current = handleToSeller[hash];
        require(current == address(0) || current == msg.sender, "handle taken");

        // Free the caller's previous handle (if any and different).
        bytes memory prev = bytes(sellerHandle[msg.sender]);
        if (prev.length != 0) {
            bytes32 prevHash = keccak256(prev);
            if (prevHash != hash) {
                delete handleToSeller[prevHash];
                emit HandleReleased(prevHash, msg.sender);
            }
        }

        handleToSeller[hash] = msg.sender;
        sellerHandle[msg.sender] = handle;
        emit HandleClaimed(hash, handle, msg.sender);
    }

    /// @notice Release the caller's handle, freeing it for anyone to claim.
    function release() external {
        bytes memory cur = bytes(sellerHandle[msg.sender]);
        require(cur.length != 0, "no handle");

        bytes32 hash = keccak256(cur);
        delete handleToSeller[hash];
        delete sellerHandle[msg.sender];
        emit HandleReleased(hash, msg.sender);
    }

    /// @notice Resolve a handle to its seller (`address(0)` if unclaimed).
    ///         Convenience wrapper over `handleToSeller[keccak256(handle)]`.
    function resolve(string calldata handle) external view returns (address) {
        return handleToSeller[keccak256(bytes(handle))];
    }

    // --- Validation ---

    /// @dev Reverts unless `handle` is 3–32 chars of [a-z0-9-] with no leading or
    ///      trailing '-'. Lowercase-only keeps the keccak key canonical.
    function _validate(string calldata handle) internal pure {
        bytes calldata b = bytes(handle);
        require(b.length >= 3 && b.length <= 32, "bad length");
        require(b[0] != 0x2d && b[b.length - 1] != 0x2d, "bad hyphen"); // no leading/trailing '-'

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x2d; // '-'
            require(ok, "bad char");
        }
    }
}
