# FreeMarket — monorepo build / test / deploy
# Adapt per-shop deploy from SwarmChat's `make deploy-frontend` (see CLAUDE.md §8).

.PHONY: help build test contracts-build contracts-test deploy-contract storefront cms deploy-frontend deploy-frontend-build

help:
	@echo "FreeMarket targets:"
	@echo "  make build            - build all packages and apps"
	@echo "  make test             - run all tests"
	@echo "  make contracts-build  - forge build (contracts/)"
	@echo "  make contracts-test   - forge test (contracts/)"
	@echo "  make deploy-contract  - deploy Marketplace (set RPC_URL; dry-run if unset)"
	@echo "  make storefront       - dev server for apps/storefront"
	@echo "  make cms              - dev server for apps/cms"
	@echo "  make deploy-frontend       - upload prebuilt storefront dist to Swarm + print/set ENS contenthash (print-only by default)"
	@echo "  make deploy-frontend-build - same, but build the storefront first (BUILD=1)"

build: contracts-build
	@echo "TODO: build packages/* and apps/*"

test: contracts-test
	@echo "TODO: run package/app tests"

contracts-build:
	cd contracts && forge build

contracts-test:
	cd contracts && forge test

# Deploy the Marketplace escrow contract + seed its accepted-token allowlist.
# Config via env (all optional): TOKENS (comma-separated ERC-20s; default Gnosis
# WXDAI + USDC), OWNER (arbiter; default broadcaster). Set RPC_URL + PRIVATE_KEY
# to broadcast; with neither it's a local dry-run. See contracts/README.md.
deploy-contract:
	cd contracts && forge script script/Deploy.s.sol:Deploy \
	  $(if $(RPC_URL),--rpc-url $(RPC_URL) --broadcast,)

storefront:
	@echo "TODO: cd apps/storefront && npm run dev"

cms:
	@echo "TODO: cd apps/cms && npm run dev"

# Per-shop Swarm + ENS deploy pipeline (CLAUDE.md §8 / build step #7):
# build storefront -> upload dist to Swarm as a collection -> update a Swarm feed
# -> encode the EIP-1577 swarm contenthash -> set/print it on mainnet ENS.
#
# Config is ALL via env, passed straight through to scripts/deploy-frontend.mjs
# (see its header or docs/DEPLOY.md). Required: POSTAGE_BATCH_ID, FEED_PRIVATE_KEY.
# Common: BEE_URL, DIST_DIR (or BUILD=1), ENS_NAME, plus any VITE_* for the build.
#
# DRY-RUN / PRINT-ONLY by default: it never broadcasts a mainnet tx. A live ENS
# set requires ENS_RPC_URL + ENS_PRIVATE_KEY + CONFIRM_MAINNET=1 (opt-in).
# Mirrors deploy-contract's env-passthrough style. Run from scripts/ where the
# pipeline's own deps (bee-js, content-hash, viem) are installed.
deploy-frontend:
	cd scripts && node deploy-frontend.mjs

# Convenience: same pipeline, but build the storefront first (BUILD=1). Pass the
# shop's VITE_* config on the command line, e.g.
#   make deploy-frontend-build VITE_MARKETPLACE_ADDRESS=0x.. VITE_SELLER=0x.. \
#     POSTAGE_BATCH_ID=.. FEED_PRIVATE_KEY=.. ENS_NAME=shop.eth
deploy-frontend-build:
	cd scripts && BUILD=1 node deploy-frontend.mjs
