import { useState, useEffect, useRef } from 'react';
import { CustomWalletButton } from './CustomWalletButton';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { toast } from 'react-hot-toast';

export const WalletButton: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Try to access wallet but don't break if context not available
  let wallet: any = { publicKey: null, connected: false };
  try {
    wallet = useWallet();
    console.log('Wallet context available:', wallet);
  } catch (error) {
    console.log('Wallet context not available in button');
  }
  
  const { publicKey, connected, connecting, disconnect, select, wallets } = wallet;
  
  // Try to access wallet modal
  let walletModal: any = { setVisible: () => {} };
  try {
    walletModal = useWalletModal();
    console.log('Wallet modal available:', walletModal);
  } catch (error) {
    console.log('Wallet modal context not available');
  }
  
  // Try to access auth but handle if not available
  let auth: any = { isAuthenticated: false, user: null };
  try {
    auth = useAuth();
  } catch (error) {
    console.log('Auth context not available in button');
  }

  useEffect(() => {
    console.log('Wallet connection status changed:', { 
      publicKey: publicKey?.toString(), 
      connected,
      walletName: wallet?.wallet?.adapter?.name,
      walletsAvailable: wallets?.map(w => w.adapter?.name)
    });
    setWalletConnected(!!publicKey && connected);
  }, [publicKey, connected, wallet, wallets]);

  // Add event listener to track wallet selection
  useEffect(() => {
    const handleWalletSelected = (event: any) => {
      console.log('Wallet selection event detected:', event);
    };
    
    window.addEventListener('wallet-standard:app:connectWallet', handleWalletSelected);
    window.addEventListener('wallet-connect', handleWalletSelected);
    
    return () => {
      window.removeEventListener('wallet-standard:app:connectWallet', handleWalletSelected);
      window.removeEventListener('wallet-connect', handleWalletSelected);
    };
  }, []);

  // Add an effect to detect Phantom wallet specifically
  useEffect(() => {
    const checkPhantomWallet = () => {
      if (typeof window !== 'undefined') {
        const phantom = (window as any).phantom;
        
        if (phantom?.solana?.isPhantom) {
          console.log('✅ Phantom wallet detected in window object');
          if (phantom.solana.isConnected) {
            console.log('✅ Phantom wallet is already connected');
          } else {
            console.log('ℹ️ Phantom wallet is available but not connected');
          }
          // Log Phantom's ready state
          console.log('Phantom ready state:', {
            isPhantom: phantom.solana.isPhantom,
            isConnected: phantom.solana.isConnected,
            publicKey: phantom.solana.publicKey?.toString()
          });
        } else {
          console.log('❌ Phantom wallet not detected in window object');
        }
      }
    };
    
    // Check immediately
    checkPhantomWallet();
    
    // Also check after a delay to ensure Phantom is fully loaded
    const timeoutId = setTimeout(checkPhantomWallet, 1000);
    
    // Check again when the component is focused
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkPhantomWallet();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      console.log('🔗 [WalletButton] Starting connection process...');
      console.log('🔗 [WalletButton] Available wallets:', wallets?.length || 0);
      console.log('🔗 [WalletButton] Wallet details:', wallets?.map(w => ({ name: w.adapter?.name, readyState: w.readyState })));

      // Check if already connected through adapter
      if (connected && publicKey) {
        console.log('🔗 [WalletButton] Already connected:', publicKey.toString());
        setIsLoading(false);
        return;
      }

      // Check if Phantom is available in window and try to connect directly
      if (typeof window !== 'undefined' && (window as any).phantom?.solana) {
        console.log('🔗 [WalletButton] Phantom detected in window object');
        const phantom = (window as any).phantom.solana;
        
        // Try to connect Phantom directly if not already connected through adapter
        if (!connected) {
          try {
            console.log('🔗 [WalletButton] Attempting to connect Phantom directly...');
            const response = await phantom.connect({ onlyIfTrusted: false });
            console.log('🔗 [WalletButton] Phantom connection response:', response);
            
            // After connecting, we need to trigger the adapter to recognize it
            // The Standard Wallet API should detect it, but we may need to refresh
            // For now, let's still open the modal to ensure proper adapter connection
          } catch (phantomError: any) {
            console.log('🔗 [WalletButton] Direct Phantom connection failed (will use modal):', phantomError?.message);
            // Continue to modal - user may need to approve connection
          }
        }
      }

      // Always open the modal for reliable connection through adapter
      // This ensures proper integration with the wallet adapter context
      console.log('🔗 [WalletButton] Opening wallet modal...');
      if (walletModal && typeof walletModal.setVisible === 'function') {
        walletModal.setVisible(true);
        setIsLoading(false);
        return;
      }

      // Fallback: if no modal, try to select and connect first available wallet
      if (wallets && wallets.length > 0) {
        console.log('🔗 [WalletButton] No modal available, trying direct connection...');
        const firstWallet = wallets[0];
        if (select && typeof select === 'function') {
          select(firstWallet.adapter.name);
          // The connect will happen automatically after selection
        }
      } else {
        throw new Error('No wallet adapters found. Please install a Solana wallet extension.');
      }

    } catch (error) {
      console.error('🔗 [WalletButton] ❌ Connection failed:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      toast.error(`Wallet connection failed: ${error instanceof Error ? error.message : 'Please check your wallet extension'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsLoading(true);
      console.log('Attempting to disconnect wallet...');
      
      // Force UI state update immediately
      setWalletConnected(false);
      setDropdownOpen(false);
      
      // Use AuthContext logout for consistent behavior
      if (auth?.logout) {
        console.log('Using AuthContext logout...');
        await auth.logout();
      } else {
        // Fallback to manual disconnect if AuthContext not available
        console.log('AuthContext not available, using manual disconnect...');
        
        // Try adapter-based disconnect method
        if (typeof disconnect === 'function') {
          try {
            console.log('Trying adapter disconnect()...');
            await disconnect();
            console.log('Successfully disconnected via adapter');
          } catch (error) {
            console.error('Error disconnecting via adapter:', error);
          }
        }
        
        // Try direct window.solana method
        if (window && (window as any).solana) {
          try {
            console.log('Trying window.solana disconnect...');
            await (window as any).solana.disconnect();
            console.log('Successfully disconnected via window.solana');
          } catch (error) {
            console.error('Error disconnecting via window.solana:', error);
          }
        }
        
        // Clear local storage wallet data that might be persisted
        try {
          localStorage.removeItem('walletName');
          localStorage.removeItem('wallet');
          localStorage.removeItem('walletAdapter');
          // Clear any other wallet-related local storage items
          const keys = Object.keys(localStorage);
          for (const key of keys) {
            if (key.toLowerCase().includes('wallet') || key.toLowerCase().includes('solana')) {
              localStorage.removeItem(key);
            }
          }
        } catch (e) {
          console.error('Error clearing local storage:', e);
        }

        // Force a page refresh after a short delay to ensure UI updates
        setTimeout(() => {
          console.log('Refreshing page to ensure clean wallet state');
          window.location.reload();
        }, 300);
      }
      
    } catch (error) {
      console.error('Error in disconnect handler:', error);
      // Force update UI state and refresh as last resort
      setWalletConnected(false);
      setTimeout(() => window.location.reload(), 300);
    } finally {
      setIsLoading(false);
    }
  };

  return walletConnected ? (
    <div className="wallet-connected-container relative" ref={dropdownRef}>
      <CustomWalletButton 
        onClick={() => setDropdownOpen(!dropdownOpen)} 
        label={publicKey ? `${publicKey.toString().substring(0, 4)}...${publicKey.toString().substring(publicKey.toString().length - 4)}` : 'Wallet'}
        isConnected={true}
        isLoading={isLoading || connecting}
      />
      
      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-md shadow-lg py-1 z-10 border border-gray-700 overflow-hidden">
          <button
            onClick={handleDisconnect}
            className="flex items-center w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-700"
          >
            <span className="mr-2">🔌</span> Disconnect Wallet
          </button>
        </div>
      )}
    </div>
  ) : (
    <div className="wallet-buttons">
      <CustomWalletButton 
        onClick={handleConnect} 
        label="Connect Wallet"
        isConnected={false}
        isLoading={isLoading || connecting}
      />
      

      
      {isLoading && (
        <div className="wallet-connection-help">
          <small>
            If wallet doesn't connect, check your wallet extension is unlocked and try again.
          </small>
        </div>
      )}
    </div>
  );
}; 