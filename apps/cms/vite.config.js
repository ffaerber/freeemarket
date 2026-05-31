import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// FreeMarket CMS / admin — Vite config (copied from the storefront).
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
});
