import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl } from '@solana/web3.js';
import { SolanaProvider } from './contexts/SolanaContext';
import { AuthProvider } from './contexts/AuthContext';
import '@solana/wallet-adapter-react-ui/styles.css';
import { BrowserRouter } from 'react-router-dom';
import { checkEnvironmentVariables } from './utils/checkEnv';
import { env } from './utils/env';
import { PrivyProvider } from '@privy-io/react-auth';
import honLogo from './assets/hon-logo.svg';
import { accessHeaders } from './services/apiAccess';
import { authenticatedApiFetch } from './utils/apiRequest';

// All canvas tools use provider proof for same-origin API calls. Third-party
// fetches (including auth SDKs and model media) never receive that proof.
window.fetch = authenticatedApiFetch(window.fetch.bind(window), accessHeaders, window.location.href);

// Performance measurement
console.time('app-initialization');

// Use PrivyProvider directly; render it only when enabled

// Ensure consistent network configuration
const network = (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet';
const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network as any);

// Initialize wallet adapters
// We need to be careful about which adapters we include
const wallets = [];

// Only add non-Standard wallets or those that need explicit configuration
try {
  // Add adapters one by one to avoid issues
  // Use detection options to prevent conflicts with Standard Wallet API
  const detectionOptions = { 
    iframe: false,
    timeout: 3000 // Give more time for wallet detection
  };
  
  wallets.push(new PhantomWalletAdapter(detectionOptions));
  wallets.push(new SolflareWalletAdapter(detectionOptions));
  
  // Don't add Backpack adapter - it works via Standard Wallet
  
} catch (e) {
  console.error('Error initializing wallet adapters:', e);
}

// Check environment variables but don't block rendering
checkEnvironmentVariables();

console.log('Initializing app...');
console.log(' Network:', network);
console.log(' Endpoint:', endpoint);
console.log(' Wallets:', wallets.map(w => w.name));
console.log(' Wallet details:', wallets.map(w => ({ 
  name: w.name, 
  readyState: w.readyState,
  publicKey: w.publicKey?.toString() || 'null'
})));
console.log(' Helpful direct links:');
console.log(' → Cloudinary Tester: http://localhost:5173/cloudinary-tester');

// Define a wallet error handler to help with debugging
const onError = (error: Error) => {
  console.error('🚨 Wallet error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack
  });
};

// Bridge component to allow dynamic Privy landing header (e.g., "Log in" vs "Sign up")
const RootApp: React.FC = () => {
  const [privyHeader, setPrivyHeader] = useState<string>('Log in');

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (typeof ce.detail === 'string' && ce.detail.length) {
        setPrivyHeader(ce.detail);
      }
    };
    window.addEventListener('privy:set-header' as any, handler);
    // Expose a helper for pages to trigger a header change before opening Privy
    (window as any).setPrivyHeader = (text: string) => {
      window.dispatchEvent(new CustomEvent('privy:set-header', { detail: text }));
    };
    return () => window.removeEventListener('privy:set-header' as any, handler);
  }, []);

  const appTree = (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={true} 
        onError={onError}>
        <WalletModalProvider>
          <SolanaProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </SolanaProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );

  if (env.VITE_PRIVY_ENABLED === 'true') {
    return (
      <PrivyProvider
        appId={import.meta.env.VITE_PRIVY_APP_ID || ''}
        config={{
          appearance: {
            logo: <img src={honLogo} alt="Hon" />,
            theme: 'dark',
            showWalletLoginFirst: false,
            // @ts-ignore
            loginMethodsAndOrder: ['email', 'google', 'twitter', 'discord', 'wallet'],
            landingHeader: privyHeader
          },
          externalWallets: {
            // Enable Solana providers so Privy can talk to Phantom/Backpack
            // @ts-ignore
            solana: {
              providers: ['phantom', 'backpack'],
              options: { cluster: (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet' }
            },
          },
          embeddedWallets: {
            showWalletUIs: false,
            priceDisplay: { primary: 'native-token', secondary: null }
          }
        }}
      >
        {appTree}
      </PrivyProvider>
    );
  }
  return appTree;
};

// The order matters! The correct nesting order is:
// BrowserRouter (outer) -> (PrivyProvider) -> ConnectionProvider -> WalletProvider -> WalletModalProvider -> SolanaProvider -> AuthProvider -> App (inner)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootApp />
    </BrowserRouter>
  </React.StrictMode>
);

console.timeEnd('app-initialization');
