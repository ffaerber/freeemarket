import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// FreeeMarket CMS / admin — Vite config (copied from the storefront).
//
// @ethersphere/bee-js targets Node and imports Node builtins (`stream`, `fs`,
// `path`, plus a `Buffer`/`global` runtime). The CMS uses bee-js's WRITE path
// (`uploadData`/`uploadFile`) in addition to reads, so it pulls in even more of
// bee-js — we polyfill the Node builtins with vite-plugin-node-polyfills so it
// bundles cleanly for a browser SPA build. Rollup resolves all static imports
// at build time, so the polyfills must be present regardless of which bee-js
// paths run at runtime.
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
