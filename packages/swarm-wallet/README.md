# swarm-wallet

Shared wallet connection, Gnosis chain switching, and Swarm postage stamp selection for web3 apps built on Gnosis Chain + Ethereum Swarm.

Consolidates the duplicated `useBee`, `BeeContext`, `ChainGuard`, and connect-modal logic from SwarmChat, PinkChainsaw, and FreeeMarket into one package — one design, one flow.

---

## What it provides

| Export | Type | Description |
|---|---|---|
| `useBee(options?)` | React hook | Bee node health, topology, postage batches, PSS keys |
| `BeeProvider` | React context | Wraps an app with bee state |
| `useBeeContext()` | React hook | Read bee state from anywhere inside `BeeProvider` |
| `ChainGuard` | Component | Full-screen overlay that prompts to switch to Gnosis Chain |
| `ConnectModal` | Component | Setup modal: wallet → chain → Bee node → postage stamp |
| `WalletButton` | Component | Compact connect / address pill for nav bars |
| `createGnosisWagmiConfig(opts?)` | Function | wagmi v2 config factory targeting Gnosis Chain |
| `DEFAULT_THEME` | Constant | Default dark color tokens |

---

## Installation

```bash
npm install swarm-wallet
```

Peer dependencies (install separately in your app):

```bash
npm install wagmi viem @tanstack/react-query @ethersphere/bee-js react react-dom
```

---

## Quick start

```tsx
// main.tsx
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createGnosisWagmiConfig, BeeProvider } from 'swarm-wallet'

const wagmiConfig = createGnosisWagmiConfig()
const queryClient = new QueryClient()

export default function Root() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BeeProvider>
          <App />
        </BeeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

```tsx
// App.tsx
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ChainGuard, ConnectModal, WalletButton } from 'swarm-wallet'

const THEME = { accent: '#e84393' } // pink override

export default function App() {
  const { isConnected } = useAccount()
  const [open, setOpen] = useState(false)

  return (
    <>
      {isConnected && <ChainGuard appName="PinkChainsaw" theme={THEME} />}

      <nav>
        <WalletButton onClick={() => setOpen(true)} theme={THEME} />
      </nav>

      {open && (
        <ConnectModal onClose={() => setOpen(false)} theme={THEME}>
          {/* App-specific checks go here — rendered below the standard ones */}
          <BzzBalanceCheck />
          <BzzAllowanceCheck />
        </ConnectModal>
      )}
    </>
  )
}
```

---

## API

### `createGnosisWagmiConfig(options?)`

Creates a wagmi v2 config for Gnosis Chain with an injected connector.

```ts
const config = createGnosisWagmiConfig({
  rpcUrl: 'https://rpc.gnosischain.com', // optional, this is the default
})
```

Register the type in your app for full wagmi TypeScript inference:

```ts
declare module 'wagmi' {
  interface Register { config: typeof config }
}
```

---

### `BeeProvider` / `useBeeContext()`

`BeeProvider` holds the Bee node state for all children. Pass optional `options` to override defaults.

```tsx
<BeeProvider options={{ defaultUrl: 'http://localhost:1633', storageKey: 'my-app-bee-url' }}>
  {children}
</BeeProvider>
```

```ts
const {
  reader,          // Bee — local node if connected, gateway otherwise
  writer,          // Bee — always the local node
  readUrl,         // string — base URL for <img src> tags
  beeUrl,          // string — current local node URL
  updateBeeUrl,    // (url: string) => void — persists to localStorage
  isConnected,     // boolean — local node reachable?
  peerCount,       // number
  allBatches,      // PostageBatch[]
  batchId,         // string | null — selected usable batch
  selectBatch,     // (id: string) => void
  pssPublicKey,    // string | undefined — 33-byte compressed key (hex)
  swarmOverlay,    // string | undefined — overlay address (hex)
} = useBeeContext()
```

#### `UseBeeOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultUrl` | `string` | `'http://localhost:1633'` | Initial Bee API URL |
| `gatewayUrl` | `string` | `'https://api.gateway.ethswarm.org'` | Public gateway used when no local node |
| `storageKey` | `string` | `'bee-api-url'` | `localStorage` key for persisting the URL |

---

### `ChainGuard`

Renders a full-screen "Wrong Network" overlay when the wallet is connected to any chain other than Gnosis Chain. Returns `null` when the chain is correct or the wallet is disconnected.

```tsx
<ChainGuard
  appName="SwarmChat"          // shown in the message, optional
  theme={{ accent: '#ff7a00' }}
  requiredChainId={100}        // default: gnosis.id
/>
```

---

### `ConnectModal`

A setup checklist modal covering wallet, xDAI balance, Bee node URL, Swarm peers, and postage stamp selection. Requires `BeeProvider` in the tree.

```tsx
<ConnectModal
  onClose={() => setOpen(false)}
  title="Connect"               // optional, default "Connect"
  theme={{ accent: '#ff7a00' }}
>
  {/* Optional: app-specific checks rendered below the standard ones */}
  <PssRegistrationSection />
</ConnectModal>
```

Standard checks in order:

1. **Wallet** — connect / disconnect via injected connector
2. **xDAI balance** — warns if the wallet has no xDAI
3. **Bee node** — URL input + health check (3 s timeout)
4. **Swarm peers** — shows connected peer count
5. **Postage stamp** — dropdown of usable batches

`children` are rendered between the checklist and the OK button — use this for app-specific checks such as token balances, allowances, or on-chain registration steps.

---

### `WalletButton`

A compact button that shows either a "connect" label or the short-form connected address. Clicking always calls `onClick` — the caller decides whether to open a modal or disconnect.

```tsx
<WalletButton
  onClick={() => setModalOpen(true)}
  theme={{ accent: '#e84393' }}
  connectLabel="Connect wallet"  // optional
/>
```

---

### Theme

All components accept an optional `theme` prop. Only override the tokens you want to change — the rest fall back to `DEFAULT_THEME`.

```ts
import { DEFAULT_THEME, type SwarmWalletTheme } from 'swarm-wallet'

// DEFAULT_THEME:
{
  accent:  '#ff7a00',  // buttons, links, active states
  bg:      '#18130f',  // modal background
  surface: '#0d0a08',  // input / select background
  text:    '#f5ede4',  // primary text
  muted:   '#a39690',  // secondary / placeholder text
  border:  '#2e261f',  // borders
}
```

Per-app overrides used in the existing projects:

| App | `accent` | `bg` | `border` |
|---|---|---|---|
| SwarmChat | `#ff7a00` | `#18130f` | `#2e261f` |
| PinkChainsaw | `#e84393` | `#1b1e1f` | `#252525` |
| FreeeMarket | `#3b82f6` | `#0f172a` | `#1e293b` |

---

## Migrating existing apps

### SwarmChat / PinkChainsaw

Remove these local files (they move into the package):

```
frontend/src/hooks/useBee.ts        → useBee (hook)
frontend/src/hooks/BeeContext.tsx   → BeeProvider, useBeeContext
frontend/src/components/ChainGuard.tsx → ChainGuard
frontend/src/config/wagmi.ts        → createGnosisWagmiConfig
```

Keep `Modal.tsx` but replace the standard checks with `<ConnectModal>` and move the app-specific parts into `children`:

```tsx
// SwarmChat: keep PSS registration in Modal.tsx as ConnectModal children
// PinkChainsaw: keep BZZ balance + allowance checks as ConnectModal children
```

### FreeeMarket storefront / CMS

Replace the inline `WalletButton` in `chrome.jsx` with the one from this package. Upgrade `@ethersphere/bee-js` to `^11.0.0` to match the shared hook's API.

---

## Package structure

```
swarm-wallet/
├── src/
│   ├── types.ts                  # SwarmWalletTheme, UseBeeOptions, DEFAULT_THEME
│   ├── hooks/
│   │   ├── useBee.ts             # Core Bee hook
│   │   └── BeeContext.tsx        # Provider + context
│   ├── components/
│   │   ├── ChainGuard.tsx
│   │   ├── ConnectModal.tsx
│   │   └── WalletButton.tsx
│   ├── config/
│   │   └── wagmi.ts              # createGnosisWagmiConfig
│   └── index.ts                  # Barrel exports
├── package.json
├── tsconfig.json
└── tsup.config.ts                # tsup — ESM + CJS + .d.ts
```

**Key constraints:**
- No CSS/Tailwind dependency — all styling via inline styles and the `theme` prop
- Peer deps: `react >=18`, `wagmi >=2`, `viem >=2`, `@ethersphere/bee-js >=11`
- Output: ESM + CJS dual build via tsup
- TypeScript strict mode
- No hard-coded chain IDs or contract addresses — everything overridable via props / options
