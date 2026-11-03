import { createContext, useContext, useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallet } from '@solana/wallet-adapter-react';
import { supabase } from '../utils/supabaseClient';

interface AuthContextType {
  isAuthenticated: boolean;
  user: {
    id: string | null;
    username: string | null;
    wallet: string | null;
    authMethod: 'discord' | 'twitter' | 'google' | 'wallet' | null;
    avatar_url?: string | null;
  } | null;
  loading: boolean;
  error: string | null;
  updateUsername?: (username: string) => Promise<void>;
  logout?: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  loading: true,
  error: null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { publicKey } = useWallet();
  // Privy session (if enabled)
  let privy: any = {};
  try {
    privy = usePrivy();
  } catch {}
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletProfile, setWalletProfile] = useState<any>(null);
  const [privyProfile, setPrivyProfile] = useState<any>(null);

  useEffect(() => {
    // Prefer Supabase session; if none, mirror Privy auth as a lightweight session for UI gating
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session || (privy?.authenticated ? { user: { id: privy?.user?.id, email: privy?.user?.email } } : null));
      setLoading(false);
    });

    // Listen for Supabase auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session || (privy?.authenticated ? { user: { id: privy?.user?.id, email: privy?.user?.email } } : null));
    });

    return () => subscription.unsubscribe();
  }, [privy?.authenticated]);

  // When Privy authenticates, ensure a Supabase profile exists/updates
  useEffect(() => {
    const syncPrivyToSupabase = async () => {
      try {
        if (!privy?.authenticated || !privy?.user?.id) return;
        const email = privy?.user?.email ?? null;
        const name = privy?.user?.name ?? null;
        const provider = 'privy';

        // Check for existing profile by email (preferred) or privy id
        let existing: any = null;
        if (email) {
          const { data } = await supabase.from('profiles').select('*').eq('email', email).maybeSingle();
          existing = data;
        }

        const basePayload: any = {
          email,
          username: name,
          auth_method: provider,
          updated_at: new Date().toISOString()
        };

        if (!existing) {
          const payload = {
            ...basePayload,
            // fallbacks
            is_creator: false,
            subscription_tier: 'free',
            subscription_status: 'inactive',
            preferences: {},
            social_links: {},
            created_at: new Date().toISOString()
          };
          const { data: inserted, error: insertErr } = await supabase.from('profiles').insert(payload).select().single();
          if (insertErr) throw insertErr;
          setPrivyProfile(inserted);
        } else {
          const { data: updated, error: updateErr } = await supabase.from('profiles').update(basePayload).eq('id', existing.id).select().single();
          if (updateErr) throw updateErr;
          setPrivyProfile(updated);
        }
      } catch (err) {
        console.error('Failed to sync Privy user to Supabase:', err);
      }
    };

    syncPrivyToSupabase();
  }, [privy?.authenticated, privy?.user?.email, privy?.user?.name]);

  // Handle wallet authentication
  useEffect(() => {
    // DEBUG: Log the publicKey received by AuthContext
    console.log('[AuthContext] publicKey received:', publicKey);
    if (publicKey) {
      console.log('[AuthContext] publicKey.toString():', publicKey.toString());
    }

    const handleWalletAuth = async () => {
      if (!publicKey) {
        setWalletProfile(null);
        return;
      }

      try {
        console.log('Checking profile for wallet:', publicKey.toString());
        
        // First check if user has an authenticated session (email/social login)
        if (session?.user) {
          console.log('User has active session, linking wallet to existing account');
          
          // Check if this user already has a profile
          const { data: userProfile, error: userProfileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (userProfileError && userProfileError.code !== 'PGRST116') {
            console.error('Error checking user profile:', userProfileError);
            throw userProfileError;
          }

          if (userProfile) {
            // Update existing profile with wallet address
            const { data: updatedProfile, error: updateError } = await supabase
              .from('profiles')
              .update({
                solana_wallet: publicKey.toString(),
                wallet_connected: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', session.user.id)
              .select()
              .single();

            if (updateError) {
              console.error('Error linking wallet to user profile:', updateError);
              throw updateError;
            }
            
            console.log('Wallet linked to existing user profile:', updatedProfile);
            setWalletProfile(updatedProfile);
            return;
          }
        }
        
        // Check if a profile exists with this wallet address
        const { data: existingWalletProfile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('solana_wallet', publicKey.toString())
          .maybeSingle();

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('Profile query error:', profileError);
          throw profileError;
        }

        console.log('Existing wallet profile:', existingWalletProfile);

        if (!existingWalletProfile) {
          console.log('Creating new profile for wallet');
          
          const profileData: any = {
            solana_wallet: publicKey.toString(),
            wallet_connected: true,
            auth_method: 'wallet',
            is_creator: false,
            notification_preferences: {
              support_received: true,
              new_stories: true
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          // If user has active session, use their user ID, otherwise generate a wallet ID
          if (session?.user) {
            profileData.id = session.user.id;
            profileData.email = session.user.email;
            
            // Extract username from session metadata
            const provider = session.user.app_metadata?.provider || 'email';
            if (provider === 'discord') {
              profileData.username = session.user.user_metadata?.preferred_username || 
                                   session.user.user_metadata?.username;
            } else if (provider === 'google') {
              profileData.username = session.user.user_metadata?.name;
            } else {
              profileData.username = session.user.user_metadata?.username;
            }
                     } else {
             // Wallet-only authentication - create profile with wallet_id
             profileData.wallet_id = crypto.randomUUID();
           }

          // Create a new profile for the wallet
          const { data: newProfile, error: insertError } = await supabase
            .from('profiles')
            .insert(profileData)
            .select()
            .single();

          if (insertError) {
            console.error('Profile creation error:', insertError);
            throw insertError;
          }
          
          console.log('New profile created:', newProfile);
          setWalletProfile(newProfile);
        } else {
          console.log('Using existing wallet profile');
          setWalletProfile(existingWalletProfile);
        }
      } catch (err) {
        console.error('Error handling wallet auth:', err);
        setError(err instanceof Error ? err.message : 'Failed to authenticate wallet');
      }
    };

    handleWalletAuth();
  }, [publicKey]);

  const updateUsername = async (username: string) => {
    try {
      if (!publicKey) throw new Error('No wallet connected');

      console.log('Attempting to update username for wallet:', publicKey.toString());

      // First check if profile exists
      const { data: existingProfile, error: checkError } = await supabase
        .from('profiles')
        .select('*')
        .eq('solana_wallet', publicKey.toString())
        .maybeSingle();

      if (checkError) {
        console.error('Error checking profile:', checkError);
        throw checkError;
      }

      console.log('Existing profile check result:', existingProfile);

      if (!existingProfile) {
        console.log('Creating new profile with username');
        // Create profile if it doesn't exist
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            wallet_id: crypto.randomUUID(),
            solana_wallet: publicKey.toString(),
            username,
            wallet_connected: true,
            auth_method: 'wallet',
            is_creator: false,
            notification_preferences: {
              support_received: true,
              new_stories: true
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating profile:', insertError);
          throw insertError;
        }

        console.log('New profile created:', newProfile);
        setWalletProfile(newProfile);
        return;
      }

      console.log('Updating existing profile with new username');
      // Update existing profile
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({ 
          username,
          updated_at: new Date().toISOString()
        })
        .eq('solana_wallet', publicKey.toString())
        .select()
        .single();

      if (updateError) {
        console.error('Error updating profile:', updateError);
        throw updateError;
      }

      console.log('Profile updated successfully:', updatedProfile);
      setWalletProfile(updatedProfile);
    } catch (err) {
      console.error('Error updating username:', err);
      throw new Error('Failed to update username. Please try again.');
    }
  };

  const value = {
    isAuthenticated: !!session || !!publicKey,
    user: session?.user ? {
      id: session.user.id,
      username: session.user.user_metadata?.username || walletProfile?.username,
      wallet: publicKey?.toString() || walletProfile?.solana_wallet || null,
      authMethod: session.user.app_metadata?.provider || (publicKey ? 'wallet' : null),
      avatar_url: session.user.user_metadata?.avatar_url || walletProfile?.avatar_url || privyProfile?.avatar_url || null,
    } : publicKey && walletProfile ? {
      id: walletProfile.id || walletProfile.wallet_id,
      username: walletProfile.username,
      wallet: publicKey.toString(),
      authMethod: 'wallet',
      avatar_url: walletProfile?.avatar_url || null,
    } : privy?.authenticated && privyProfile ? {
      id: privyProfile.id || privy?.user?.id,
      username: privyProfile.username || privy?.user?.name,
      wallet: walletProfile?.solana_wallet || null,
      authMethod: 'privy',
      avatar_url: privyProfile?.avatar_url || (privy?.user as any)?.picture || null,
    } : null,
    loading,
    error,
    updateUsername,
    logout: async () => {
      try {
        // Sign out from Supabase
        await supabase.auth.signOut();
        
        // Clear wallet profile state
        setWalletProfile(null);
        setPrivyProfile(null);
        
        // If wallet is connected, disconnect it
        if (publicKey) {
          console.log('Disconnecting wallet during logout...');
          
          // Try to disconnect from detected wallet types
          if (window && (window as any).magicEden) {
            try {
              const isConnected = await (window as any).magicEden.isConnected();
              if (isConnected) {
                await (window as any).magicEden.disconnect();
                console.log('Disconnected from Magic Eden');
              }
            } catch (e) {
              console.log('Error disconnecting Magic Eden:', e);
            }
          }
          
          if (window && (window as any).phantom?.solana) {
            try {
              const isConnected = await (window as any).phantom.solana.isConnected;
              if (isConnected) {
                await (window as any).phantom.solana.disconnect();
                console.log('Disconnected from Phantom');
              }
            } catch (e) {
              console.log('Error disconnecting Phantom:', e);
            }
          }
          
          // Try direct window.solana method
          if (window && (window as any).solana) {
            try {
              await (window as any).solana.disconnect();
              console.log('Disconnected via window.solana');
            } catch (e) {
              console.log('Error disconnecting via window.solana:', e);
            }
          }
          
          // Clear wallet-related localStorage
          try {
            localStorage.removeItem('walletName');
            localStorage.removeItem('wallet');
            localStorage.removeItem('walletAdapter');
            const keys = Object.keys(localStorage);
            for (const key of keys) {
              if (key.toLowerCase().includes('wallet') || key.toLowerCase().includes('solana')) {
                localStorage.removeItem(key);
              }
            }
          } catch (e) {
            console.error('Error clearing wallet localStorage:', e);
          }
        }
        
        // Clear Privy session if available
        if (privy?.logout) {
          try {
            await privy.logout();
            console.log('Logged out from Privy');
          } catch (e) {
            console.log('Error logging out from Privy:', e);
          }
        }
        
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        // Force page refresh to ensure clean state
        setTimeout(() => {
          try { 
            window.location.href = '/'; 
          } catch { 
            window.location.assign('/'); 
          }
        }, 100);
      }
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 