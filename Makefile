# FreeeMarket — monorepo build / test / deploy
# Adapt per-shop deploy from SwarmChat's `make deploy-frontend` (see CLAUDE.md §8).

.PHONY: help build test contracts-build contracts-test deploy-contract deploy-handle-registry storefront cms deploy-frontend deploy-frontend-build deploy-cms deploy-cms-build

help:
	@echo "FreeeMarket targets:"
	@echo "  make build            - build all packages and apps"
	@echo "  make test             - run all tests"
	@echo "  make contracts-build  - forge build (contracts/)"
	@echo "  make contracts-test   - forge test (contracts/)"
	@echo "  make deploy-contract  - deploy Marketplace (set RPC_URL; dry-run if unset)"
	@echo "  make deploy-handle-registry - deploy ownerless HandleRegistry (set RPC_URL; dry-run if unset)"
	@echo "  make storefront       - dev server for apps/storefront"
	@echo "  make cms              - dev server for apps/cms"
	@echo "  make deploy-frontend       - upload prebuilt storefront dist to Swarm + print/set ENS contenthash (print-only by default)"
	@echo "  make deploy-frontend-build - same, but build the storefront first (BUILD=1)"
	@echo "  make deploy-cms            - upload prebuilt CMS admin SPA to Swarm (own feed topic; print-only by default)"
	@echo "  make deploy-cms-build      - same, but build the CMS first (BUILD=1)"

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

# Deploy the ownerless HandleRegistry (handle -> seller alias for the
# multi-tenant storefront). No config: no owner, no tokens, holds no funds.
# Set RPC_URL + PRIVATE_KEY to broadcast; with neither it's a local dry-run.
deploy-handle-registry:
	cd contracts && forge script script/DeployHandleRegistry.s.sol:DeployHandleRegistry \
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

# Deploy the CMS / admin SPA to Swarm via the SAME pipeline as the storefront
# (it's just another static Vite build). The CMS is the SHARED back-office for
# all shops (not per-shop), so it gets its OWN stable feed/ENS address via a
# distinct FEED_TOPIC. SECURITY: the CMS handles the merchant's ECIES decryption
# key + plaintext addresses (CLAUDE.md §5) — load the Swarm-hosted CMS from a
# Bee node YOU run (or pin the content hash), NOT an untrusted public gateway.
#
# Uses a prebuilt DIST_DIR by default (run `npm run build` in apps/cms first);
# pass BUILD=1 to build here. Print-only by default — a live ENS set needs
# ENS_RPC_URL + ENS_PRIVATE_KEY + CONFIRM_MAINNET=1, same as the storefront.
#   make deploy-cms POSTAGE_BATCH_ID=.. FEED_PRIVATE_KEY=.. [ENS_NAME=admin.eth]
deploy-cms:
	cd scripts && STOREFRONT_DIR=../apps/cms DIST_DIR=$(if $(DIST_DIR),$(DIST_DIR),../apps/cms/dist) \
	  FEED_TOPIC=$(if $(FEED_TOPIC),$(FEED_TOPIC),freemarket-cms) node deploy-frontend.mjs

deploy-cms-build:
	cd scripts && BUILD=1 STOREFRONT_DIR=../apps/cms \
	  FEED_TOPIC=$(if $(FEED_TOPIC),$(FEED_TOPIC),freemarket-cms) node deploy-frontend.mjs
