import React from 'react';
import { WalletButton } from '../wallet/WalletButton';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../utils/supabaseClient';
import { LogIn } from 'lucide-react';

export const LoginOptions: React.FC = () => {
  const { isAuthenticated, user } = useAuth();

  const handleSocialLogin = async (provider: 'discord' | 'twitter' | 'google') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error logging in:', error);
    }
  };

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center space-x-4">
        {!user.wallet && (
          <div className="text-sm text-gray-400">
            Connect wallet to enable support
          </div>
        )}
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4 items-center">
      <div className="flex space-x-4">
        <button
          onClick={() => handleSocialLogin('discord')}
          className="px-4 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-md flex items-center space-x-2"
        >
          <LogIn className="w-4 h-4" />
          <span>Discord</span>
        </button>
        <button
          onClick={() => handleSocialLogin('twitter')}
          className="px-4 py-2 bg-black hover:bg-gray-900 text-white rounded-md flex items-center space-x-2"
        >
          <LogIn className="w-4 h-4" />
          <span>X</span>
        </button>
        <button
          onClick={() => handleSocialLogin('google')}
          className="px-4 py-2 bg-[#DB4437] hover:bg-[#C5392D] text-white rounded-md flex items-center space-x-2"
        >
          <LogIn className="w-4 h-4" />
          <span>Google</span>
        </button>
      </div>
      
      <div className="relative w-full text-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-700"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="px-2 text-sm text-gray-500 bg-gray-900">or</span>
        </div>
      </div>

      <WalletButton />
    </div>
  );
}; 