/**
 * wagmi v2 + viem configuration for the FreeeMarket storefront.
 *
 * The escrow contract lives on Gnosis Chain (id 100) regardless of where the
 * shop's ENS name is hosted. We use an injected connector (MetaMask / Rabbit /
 * Freedom Browser's wallet) and an HTTP transport pointed at the configured
 * Gnosis RPC.
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
