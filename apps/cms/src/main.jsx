/**
 * FreeMarket CMS / admin entry point.
 *
 * Mounts the app inside the wagmi v2 + react-query providers (same setup as the
 * storefront). The wagmi config targets Gnosis Chain (id 100) with an injected
 * connector; react-query backs wagmi's hooks plus our own Swarm/contract
 * queries (useShopProfile / useMyListings / useOrders).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './wagmi.js';
import App from './App.jsx';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
