import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';

export const SOLANA_NETWORK = WalletAdapterNetwork.Devnet;
export const SOLANA_RPC_ENDPOINT = clusterApiUrl(SOLANA_NETWORK);

export const SOLANA_CONFIG = {
  network: SOLANA_NETWORK,
  endpoint: SOLANA_RPC_ENDPOINT,
  // Disable autoConnect on preview deployments to prevent connection issues
  autoConnect: typeof window !== 'undefined' && window.location.hostname.includes('vercel.app') ? false : true,
  walletConfig: {
    detectionOptions: {
      iframe: false,
      // Increase timeout for DOM detection
      timeout: 10000,
      // Disable polling to prevent excessive DOM checks
      pollingInterval: 0
    }
  }
}; 