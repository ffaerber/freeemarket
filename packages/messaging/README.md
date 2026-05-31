# @freemarket/messaging

Bidirectional encrypted messaging over **Swarm PSS** for FreeMarket. Implements
the private-message flow in [CLAUDE.md §5](../../CLAUDE.md): each payload is
**ECIES-encrypted** to the recipient's public key (`eciesjs`), wrapped in a
**signed envelope** so the receiver can cryptographically verify the sender is
the expected on-chain counterparty, then delivered over **PSS + a per-recipient
Swarm feed** (store-and-forward for offline recipients).

> ECIES via `eciesjs` — **NOT** MetaMask's `eth_decrypt` /
> `eth_getEncryptionPublicKey`, which are deprecated (CLAUDE.md §3).

## Bidirectional flow

Both directions use the **same machinery**; only the keys/topics differ.

```
  BUYER ──── shipping address {orderId,name,address} ────▶ SELLER
        encrypt → seller pubkey · sign as BUYER             decrypt w/ seller privkey
        topic: buyer-to-seller                              verify signer == order.buyer

  SELLER ── shipment update {orderId,carrier?,track?,note?} ─▶ BUYER
        encrypt → buyer pubkey · sign as SELLER             decrypt w/ buyer privkey
        topic: seller-to-buyer                              verify signer == order.seller
```

1. **Buyer → seller (address):** after `buy()` funds escrow and emits
   `OrderFunded(orderId, …, buyer, …)`, the buyer sends their shipping address.
2. **Seller → buyer (tracking):** after the seller ships, they send a tracking
   code / carrier / note back to the buyer. First-class, symmetric path.

## Security model — signed envelopes

The ciphertext alone proves nothing about *who* sent it. Each message is wrapped
in an `Envelope { version, kind, from, to, orderId, ciphertext, sig }` whose
`sig` is an EIP-191 signature over a canonical digest of
`(version, kind, orderId, from, to, ciphertext)`.

On receive, `openEnvelope(envelope, { expectedFrom })` recovers the signer and
**requires it equals the on-chain counterparty** — the seller requires
`order.buyer`, the buyer requires `order.seller`. Tampering with the ciphertext,
orderId, kind, or addresses breaks the signature. This is what binds an incoming
message to a paid, on-chain order. Distinct topics + `kind` per direction keep
the two flows isolated.

## Transport

`Transport` is an injectable interface (`send` / `receive`) so the crypto +
envelope + flows are **unit-testable without a Bee node**:

- **`InMemoryTransport`** — in-memory queue keyed by topic/recipient; used by the
  test suite to round-trip both directions.
- **`BeeTransport`** — real Swarm PSS + per-recipient feed via
  `@ethersphere/bee-js`. **Requires a writeable FULL Bee node (not a gateway)
  and a postage batch.** Use a short-lived batch so the ciphertext self-expires
  after fulfillment (CLAUDE.md §5). Both parties needing a full node is the main
  UX friction noted in the spec.

## Install / build / test

```sh
npm install
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm test           # tsx --test test/*.test.ts
```

## API

```ts
import {
  generateKeyPair, encrypt, decrypt, encryptJson, decryptJson,
  sealEnvelope, openEnvelope, verifyEnvelope,
  isShippingAddress, isShipmentUpdate,
  InMemoryTransport, BeeTransport, topicForOrder,
  sendShippingAddress, receiveShippingAddress,   // buyer → seller
  sendShipmentUpdate, receiveShipmentUpdate,     // seller → buyer
} from '@freemarket/messaging';
```

`signMessage` is injected as `(digestHex) => Promise<sigHex>`, so it works with a
viem account, a browser wallet, or a raw key in tests.

## Wiring into the apps (near-one-file swap)

The storefront and CMS currently call thin local stubs
(`apps/storefront/src/messaging/index.js`, `apps/cms/src/messaging/index.js`).
To fully activate, those stubs delegate to this library once three things are
configured per shop:

- **Counterparty ECIES public-key resolution** via SwarmChat's `ContactRegistry`
  (seller pubkey for the storefront; buyer pubkey for the CMS reply).
- **A configured full Bee node + postage batch** for `BeeTransport`.
- **The merchant's ECIES private key** from a local keystore (CMS only; never in
  client env — this is why the CMS runs locally).

Until those are wired, the stubs keep their existing signature/return shape so no
UI changes are needed; the swap is one file per app.
