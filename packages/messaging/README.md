# @freemarket/messaging

Encrypted shipping-address transport over Swarm PSS, reusing the SwarmChat
messaging stack (`envelope`, `transport`, feeds). See [CLAUDE.md §5](../../CLAUDE.md).

This may end up as a git submodule pointing at SwarmChat's `lib/` rather than a
vendored copy — decision pending (see CLAUDE.md §9, build step 3).

## TODO

- [ ] Decide: vendor vs. git submodule of SwarmChat `lib/`.
- [ ] Expose ECIES encrypt/decrypt + PSS send/receive used by storefront checkout
      and CMS order fulfillment.
