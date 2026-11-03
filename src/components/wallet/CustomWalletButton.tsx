import React from 'react';
import './CustomWalletButton.css';

interface CustomWalletButtonProps {
  onClick?: () => void;
  label?: string;
  isConnected?: boolean;
  isLoading?: boolean;
}

/**
 * A simple wallet button that doesn't rely on @solana/wallet-adapter-react-ui
 * This is used as a fallback when the wallet context isn't available
 */
export const CustomWalletButton: React.FC<CustomWalletButtonProps> = ({ 
  onClick,
  label = "Connect Wallet",
  isConnected = false,
  isLoading = false
}) => {
  const handleClick = () => {
    if (onClick && !isLoading) {
      onClick();
    }
  };

  return (
    <button 
      className={`custom-wallet-button ${isConnected ? 'connected' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <div className="spinner"></div>
      ) : null}
      <span>{isLoading ? 'Processing...' : label}</span>
      {isConnected && (
        <span className="ml-1">▼</span>
      )}
    </button>
  );
};

export default CustomWalletButton; 