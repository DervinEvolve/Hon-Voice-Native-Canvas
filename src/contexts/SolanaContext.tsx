import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

interface SolanaContextType {
  balance: number;
  isLoading: boolean;
  isConnected: boolean;
  refreshBalance: () => Promise<void>;
}

const SolanaContext = createContext<SolanaContextType>({
  balance: 0,
  isLoading: true,
  isConnected: false,
  refreshBalance: async () => {},
});

export const SolanaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const isConnected = !!publicKey;

  const getBalance = useCallback(async () => {
    if (!publicKey || !connection) return;

    try {
      // Get balance with commitment level
      const bal = await connection.getBalance(publicKey, 'confirmed');
      setBalance(bal / LAMPORTS_PER_SOL);
    } catch (e) {
      console.error('Error getting balance:', e);
    }
  }, [publicKey, connection]);

  const refreshBalance = useCallback(async () => {
    setIsLoading(true);
    await getBalance();
    setIsLoading(false);
  }, [getBalance]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const setupBalanceSubscription = async () => {
      if (!publicKey || !connection) {
        setBalance(0);
        setIsLoading(false);
        return;
      }

      // Initial balance fetch
      await getBalance();
      setIsLoading(false);

      try {
        // Subscribe to account changes
        const subscriptionId = connection.onAccountChange(
          publicKey,
          (account) => {
            setBalance(account.lamports / LAMPORTS_PER_SOL);
          },
          'confirmed'
        );

        // Backup polling every 3 seconds
        intervalId = setInterval(getBalance, 3000);

        return () => {
          try {
            connection.removeAccountChangeListener(subscriptionId);
            clearInterval(intervalId);
          } catch (e) {
            console.error('Error cleaning up subscriptions:', e);
          }
        };
      } catch (e) {
        console.error('Error setting up balance subscription:', e);
        // If subscription fails, fall back to polling only
        intervalId = setInterval(getBalance, 3000);
        return () => clearInterval(intervalId);
      }
    };

    setupBalanceSubscription();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [publicKey, connection, getBalance]);

  return (
    <SolanaContext.Provider value={{ balance, isLoading, isConnected, refreshBalance }}>
      {children}
    </SolanaContext.Provider>
  );
};

export const useSolana = () => {
  const context = useContext(SolanaContext);
  if (!context) {
    throw new Error('useSolana must be used within a SolanaProvider');
  }
  return context;
}; 