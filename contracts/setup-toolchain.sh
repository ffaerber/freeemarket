#!/usr/bin/env bash
# Install the Foundry toolchain + Solidity compiler + Solidity libs needed to
# build and test the Marketplace contract.
#
# Why not `foundryup` / svm? This repo's CI/web sandbox uses a network
# allowlist that blocks foundry.paradigm.xyz and binaries.soliditylang.org, but
# allows github.com. So we fetch release binaries straight from GitHub.
#
# Idempotent: safe to re-run. After running, ensure ~/.foundry/bin is on PATH.
set -euo pipefail

FOUNDRY_VERSION="${FOUNDRY_VERSION:-stable}"
SOLC_VERSION="${SOLC_VERSION:-0.8.20}"
OZ_VERSION="${OZ_VERSION:-v5.1.0}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Foundry (forge/cast/anvil/chisel)
if ! command -v forge >/dev/null 2>&1 && [ ! -x "$HOME/.foundry/bin/forge" ]; then
  echo "==> Installing Foundry ($FOUNDRY_VERSION)"
  mkdir -p "$HOME/.foundry/bin"
  tmp="$(mktemp)"
  curl -sL --max-time 180 -o "$tmp" \
    "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz"
  tar -xzf "$tmp" -C "$HOME/.foundry/bin" forge cast anvil chisel
  rm -f "$tmp"
fi
export PATH="$HOME/.foundry/bin:$PATH"

# 2. solc — placed at the svm-conventional path so forge --offline finds it
SOLC_DIR="$HOME/.svm/$SOLC_VERSION"
if [ ! -x "$SOLC_DIR/solc-$SOLC_VERSION" ]; then
  echo "==> Installing solc $SOLC_VERSION"
  mkdir -p "$SOLC_DIR"
  curl -sL --max-time 180 -o "$SOLC_DIR/solc-$SOLC_VERSION" \
    "https://github.com/ethereum/solidity/releases/download/v${SOLC_VERSION}/solc-static-linux"
  chmod +x "$SOLC_DIR/solc-$SOLC_VERSION"
fi

# 3. Solidity libraries (forge-std + OpenZeppelin). lib/ is gitignored.
mkdir -p "$HERE/lib"
if [ ! -d "$HERE/lib/forge-std/.git" ]; then
  echo "==> Cloning forge-std"
  git clone --depth 1 -q https://github.com/foundry-rs/forge-std "$HERE/lib/forge-std"
fi
if [ ! -d "$HERE/lib/openzeppelin-contracts/.git" ]; then
  echo "==> Cloning openzeppelin-contracts $OZ_VERSION"
  git clone --depth 1 -q --branch "$OZ_VERSION" \
    https://github.com/OpenZeppelin/openzeppelin-contracts "$HERE/lib/openzeppelin-contracts"
fi

echo "==> Done. Run:  export PATH=\"\$HOME/.foundry/bin:\$PATH\" && cd contracts && forge test --offline"
