/**
 * wagmi v2 + viem configuration for the FreeeMarket CMS / admin.
 *
 * Mirrors the storefront: the escrow contract lives on Gnosis Chain (id 100),
 * and we use an injected connector (MetaMask / Rabby / Freedom Browser's
 * wallet) with an HTTP transport pointed at the configured Gnosis RPC. The
 * merchant's connected wallet address is their seller address.
 */
import { createConfig, http } from 'wagmi';
import { gnosis } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { RPC_URL } from './config.js';

export const wagmiConfig = createConfig({
  chains: [gnosis],
  connectors: [injected()],
  transports: {
    [gnosis.id]: http(RPC_URL),
  },
});
