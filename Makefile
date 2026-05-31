# FreeMarket — monorepo build / test / deploy
# Adapt per-shop deploy from SwarmChat's `make deploy-frontend` (see CLAUDE.md §8).

.PHONY: help build test contracts-build contracts-test deploy-contract storefront cms deploy-frontend

help:
	@echo "FreeMarket targets:"
	@echo "  make build            - build all packages and apps"
	@echo "  make test             - run all tests"
	@echo "  make contracts-build  - forge build (contracts/)"
	@echo "  make contracts-test   - forge test (contracts/)"
	@echo "  make deploy-contract  - deploy Marketplace (set RPC_URL; dry-run if unset)"
	@echo "  make storefront       - dev server for apps/storefront"
	@echo "  make cms              - dev server for apps/cms"
	@echo "  make deploy-frontend  - build + upload to Swarm + set ENS contenthash (TODO)"

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

deploy-frontend:
	@echo "TODO: build storefront -> upload to Swarm (feed manifest) -> set ENS contenthash on mainnet (CLAUDE.md §8)"
