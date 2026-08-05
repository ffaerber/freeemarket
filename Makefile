# FreeeMarket — monorepo build / test / deploy
# Adapt per-shop deploy from SwarmChat's `make deploy-frontend` (see CLAUDE.md §8).

# Workspace layout. The apps consume packages/* as `file:` deps, and those
# packages resolve through their package.json `exports` → dist/, which is
# gitignored. So the packages MUST be built before an app will even resolve its
# imports (a clean checkout otherwise fails with "Failed to resolve entry for
# package @freeemarket/schema"). `packages-build` below is that step; the apps
# also run it themselves via their own `prebuild`/`predev` hooks.
PKGS := packages/schema packages/messaging
APPS := apps/storefront apps/cms

.PHONY: help bootstrap build test contracts-build contracts-test packages-build packages-test apps-build scripts-test deploy-contract deploy-handle-registry storefront cms deploy-frontend deploy-frontend-build deploy-cms deploy-cms-build

help:
	@echo "FreeeMarket targets:"
	@echo "  make bootstrap        - npm install in every package/app/scripts dir (run this first)"
	@echo "  make build            - build all packages and apps"
	@echo "  make test             - run all tests"
	@echo "  make packages-build   - build packages/* (required before any app build)"
	@echo "  make packages-test    - run the packages/* unit tests"
	@echo "  make scripts-test     - run the ops-script unit tests"
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

# Install dependencies everywhere. The packages' `prepare` scripts build their
# dist/ as part of their own install, so a bootstrap alone leaves the workspace
# in a state where the apps can resolve @freeemarket/* imports.
bootstrap:
	@for d in $(PKGS) $(APPS) scripts; do \
	  echo "==> npm install ($$d)"; \
	  (cd $$d && npm install) || exit 1; \
	done

packages-build:
	@for d in $(PKGS); do \
	  echo "==> build $$d"; \
	  (cd $$d && npm run build) || exit 1; \
	done

apps-build: packages-build
	@for d in $(APPS); do \
	  echo "==> build $$d"; \
	  (cd $$d && npm run build) || exit 1; \
	done

build: contracts-build apps-build

packages-test:
	@for d in $(PKGS); do \
	  echo "==> test $$d"; \
	  (cd $$d && npm test) || exit 1; \
	done

scripts-test:
	cd scripts && npm test

test: contracts-test packages-test scripts-test

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
	  FEED_TOPIC=$(if $(FEED_TOPIC),$(FEED_TOPIC),freeemarket-cms) node deploy-frontend.mjs

deploy-cms-build:
	cd scripts && BUILD=1 STOREFRONT_DIR=../apps/cms \
	  FEED_TOPIC=$(if $(FEED_TOPIC),$(FEED_TOPIC),freeemarket-cms) node deploy-frontend.mjs
