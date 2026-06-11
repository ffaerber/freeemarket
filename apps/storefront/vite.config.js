import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// FreeeMarket storefront — Vite config.
//
// @ethersphere/bee-js targets Node and imports Node builtins (`stream`, `fs`,
// `path`, plus a `Buffer`/`global` runtime). For a browser SPA build we polyfill
// those with vite-plugin-node-polyfills so bee-js bundles cleanly. We only call
// bee-js's `downloadData` path in the storefront, but Rollup still resolves all
// of its static imports, so the polyfills must be present at build time.
//
// eciesjs is pure ESM and bundles without special handling.
export default defineConfig({
  plugins: [
    nodePolyfills({
      // Provide Buffer + global + process shims that bee-js / web3 libs expect.
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    react(),
  ],
  resolve: {
    // The linked `@freemarket/messaging` package keeps its OWN node_modules (for
    // its standalone test suite), so without deduping, Vite would resolve bee-js
    // and its transitive deps (e.g. js-sha3) from that nested tree — where the
    // node-polyfill shims aren't reachable, breaking the build. Deduping forces
    // these shared deps to resolve from THIS app's node_modules, where the
    // polyfill plugin is active.
    dedupe: ['@ethersphere/bee-js', 'eciesjs', 'viem', 'js-sha3'],
  },
});
