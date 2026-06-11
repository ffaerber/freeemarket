/**
 * FreeeMarket storefront entry point.
 *
 * Mounts the app inside the wagmi v2 + react-query providers. The wagmi config
 * targets Gnosis Chain (id 100) with an injected connector; react-query backs
 * wagmi's hooks plus our own Swarm fetch queries (useShop / useListings).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './wagmi.js';
import Storefront from './Storefront.jsx';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Storefront />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
