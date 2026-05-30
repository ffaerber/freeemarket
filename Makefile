# FreeMarket — monorepo build / test / deploy
# Adapt per-shop deploy from SwarmChat's `make deploy-frontend` (see CLAUDE.md §8).

.PHONY: help build test contracts-build contracts-test storefront cms deploy-frontend

help:
	@echo "FreeMarket targets:"
	@echo "  make build            - build all packages and apps"
	@echo "  make test             - run all tests"
	@echo "  make contracts-build  - forge build (contracts/)"
	@echo "  make contracts-test   - forge test (contracts/)"
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

storefront:
	@echo "TODO: cd apps/storefront && npm run dev"

cms:
	@echo "TODO: cd apps/cms && npm run dev"

deploy-frontend:
	@echo "TODO: build storefront -> upload to Swarm (feed manifest) -> set ENS contenthash on mainnet (CLAUDE.md §8)"
