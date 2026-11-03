import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { WalletButton } from './wallet/WalletButton';
import { supabase } from '../utils/supabaseClient';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import honLogo from '../assets/hon-logo.svg';
import { WaitlistSignup } from './WaitlistSignup';
import { env } from '../utils/env';
import { usePrivy } from '@privy-io/react-auth';

// Feature flag from env so preview/prod can toggle without code changes
const WAITLIST_MODE = env.VITE_WAITLIST_MODE === 'true';

export default function Login() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const captchaRef = React.useRef<HCaptcha>(null);

  // Get hCaptcha site key from environment
  const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY;
  
  // Check if we're in development or preview environment (bypass CAPTCHA)
  const isDevelopment = import.meta.env.DEV || 
                       window.location.hostname.includes('vercel.app') ||
                       window.location.hostname.includes('netlify.app') ||
                       window.location.hostname === 'localhost';

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Listen for auth state changes and create profiles
  React.useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const user = session.user;
        const email = user.email || '';
        const provider = user.app_metadata?.provider || 'email';
        
        // Extract username based on provider
        let username = null;
        if (provider === 'discord') {
          username = user.user_metadata?.preferred_username || 
                    user.user_metadata?.username || 
                    user.user_metadata?.name ||
                    null;
        } else if (provider === 'google') {
          username = user.user_metadata?.name || 
                    user.user_metadata?.full_name ||
                    null;
        } else {
          username = user.user_metadata?.username || 
                    user.user_metadata?.display_name || 
                    null;
        }
        
        try {
          await createUserProfile(user.id, email, username, provider);
          console.log(`Profile created/updated for ${provider} user:`, user.id);
        } catch (error) {
          console.error(`Failed to create profile for ${provider} user:`, error);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Create or update user profile in database
  const createUserProfile = async (userId: string, email: string, username?: string, authMethod: string = 'email') => {
    try {
      const { data: existingProfile, error: checkError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing profile:', checkError);
        throw checkError;
      }

      if (!existingProfile) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            username: username || null,
            email: email,
            subscription_tier: 'free',
            subscription_status: 'inactive',
            is_verified: false,
            is_creator: false,
            preferences: {},
            social_links: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.error('Error creating profile:', insertError);
          throw insertError;
        }
        
        console.log('Profile created successfully for user:', userId);
      }
    } catch (error) {
      console.error('Error managing user profile:', error);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (WAITLIST_MODE) return; // Skip in waitlist mode
    
    if (!email) return;
    
    if (isSignUpMode && (!username || !password)) {
      alert('Please fill in all fields to create your account.');
      return;
    }
    
    if (!isDevelopment && !captchaToken) {
      alert('Please complete the CAPTCHA verification.');
      return;
    }
    
    setIsLoading(true);
    try {
      if (isSignUpMode) {
        const signUpOptions: any = {
          data: {
            username: username,
            display_name: username
          },
          emailRedirectTo: window.location.origin
        };
        
        if (!isDevelopment && captchaToken) {
          signUpOptions.captchaToken = captchaToken;
        }
        
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: signUpOptions
        });
        
        if (error) throw error;
        
        if (data.user && data.user.id) {
          try {
            await createUserProfile(data.user.id, email, username, 'email');
          } catch (profileError) {
            console.warn('Profile creation failed but auth succeeded:', profileError);
          }
        }
        
        alert('Check your email to confirm your account!');
        captchaRef.current?.resetCaptcha();
        setCaptchaToken(null);
      } else {
        const otpOptions: any = {
          emailRedirectTo: window.location.origin
        };
        
        if (!isDevelopment && captchaToken) {
          otpOptions.captchaToken = captchaToken;
        }
        
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: otpOptions
        });
        
        if (error) throw error;
        
        alert('Check your email for the login link!');
        captchaRef.current?.resetCaptcha();
        setCaptchaToken(null);
      }
    } catch (error) {
      console.error('Error with authentication:', error);
      alert(isSignUpMode ? 'Error creating account. Please try again.' : 'Error sending email. Please try again.');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'discord' | 'google') => {
    if (WAITLIST_MODE) return; // Skip in waitlist mode
    
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

  const handleModeToggle = (signUpMode: boolean) => {
    if (signUpMode === isSignUpMode) return;
    
    setIsSignUpMode(signUpMode);
    
    // Clear form fields when switching modes
    if (!signUpMode) {
      setUsername('');
      setPassword('');
    }
    
    // Reset CAPTCHA when switching modes
    if (captchaRef.current) {
      captchaRef.current.resetCaptcha();
      setCaptchaToken(null);
    }
  };

  // Minimal Privy controls gated by env; keeps UI unchanged
  let privyReady = false;
  let privyAuthenticated = false;
  let privyLogin: undefined | (() => void);
  let privyLogout: undefined | (() => void);
  let privyLinkWallet: undefined | (() => void);
  try {
    // Only attempt if enabled
    if (env.VITE_PRIVY_ENABLED === 'true') {
      const { ready, authenticated, login, logout, linkWallet } = usePrivy();
      privyReady = !!ready;
      privyAuthenticated = !!authenticated;
      privyLogin = login;
      privyLogout = logout;
      privyLinkWallet = linkWallet;
    }
  } catch {}

  return (
    <div className="min-h-screen bg-[#0a0a0a] relative overflow-hidden">
      {/* Neutral background (no hosted video) */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #1f2630 50%, #2e2538 100%)' }} aria-hidden="true" />
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/80" />
      
      {/* Navigation */}
      <nav className="relative z-10 w-full h-20 flex items-center justify-between px-6 sm:px-8 lg:px-16">
        <Link to="/" className="flex items-center">
          <img 
            src={honLogo} 
            alt="Hon Logo" 
            className="h-7"
          />
        </Link>
        
        <div className="opacity-0 pointer-events-none">
          {/* Navigation items hidden on login page */}
        </div>
      </nav>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 sm:space-y-10">
          {/* Glassmorphic Toggle */}
          <div className="flex justify-center">
            <div className="bg-white/10 backdrop-blur-md rounded-full p-1 w-full max-w-[400px] h-[60px] sm:h-[76px] relative border border-white/20">
              <div 
                className={`absolute bg-white/20 backdrop-blur-sm rounded-full shadow-lg h-[52px] sm:h-[68px] w-1/2 top-1 transition-all duration-300 border border-white/30 ${
                  !isSignUpMode ? 'left-1' : 'left-1/2'
                }`}
              />
              <div className="flex h-full">
                <button
                  onClick={() => handleModeToggle(false)}
                  className={`flex-1 flex items-center justify-center font-['Inter'] font-bold text-base sm:text-[21px] transition-colors ${
                    !isSignUpMode ? 'text-white' : 'text-white/70'
                  }`}
                >
                  Log in
                </button>
                <button
                  onClick={() => handleModeToggle(true)}
                  className={`flex-1 flex items-center justify-center font-['Inter'] font-bold text-base sm:text-[21px] transition-colors ${
                    isSignUpMode ? 'text-white' : 'text-white/70'
                  }`}
                >
                  Sign up
                </button>
              </div>
            </div>
          </div>

          {/* Login Form */}
          <div className="space-y-6 sm:space-y-8">
            {WAITLIST_MODE ? (
              // Waitlist Mode - Replace form content only
              <>
                {!isSignUpMode ? (
                  // Login Tab - Access Code
                  <form className="space-y-4 sm:space-y-[18px]">
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Access code"
                        className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[rgba(7,10,13,0.8)] text-white placeholder-white/70 rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-sm sm:text-base text-center tracking-widest font-mono"
                        maxLength={8}
                        style={{ letterSpacing: '0.3em' }}
                        disabled
                      />
                      <button
                        type="button"
                        disabled
                        className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[#872CFF] hover:bg-[#7A25E6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full border border-[#6f00ff] transition-all text-base sm:text-[20px] flex items-center justify-center"
                      >
                        Enter
                      </button>
                    </div>
                  </form>
                ) : (
                  // Sign Up Tab - Waitlist
                  <WaitlistSignup />
                )}
              </>
            ) : (
              // Original Login Mode
              <>
                {/* Privy-first auth: show Privy primary button when enabled */}
                {env.VITE_PRIVY_ENABLED === 'true' && privyReady && !privyAuthenticated && (
                  <div className="space-y-4 sm:space-y-[18px]">
                    <button
                      type="button"
                      onClick={() => {
                        try { (window as any).setPrivyHeader?.(!isSignUpMode ? 'Log in' : 'Sign up'); } catch {}
                        privyLogin && privyLogin();
                      }}
                      className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-2.5 bg-white text-black rounded-full transition-all flex items-center justify-center gap-4 sm:gap-5 text-base sm:text-[20px] min-w-[220px]"
                    >
                      Continue with Privy
                    </button>
                    <div className="text-center text-white/60 text-sm">or</div>
                  </div>
                )}

                {/* Simplified: keep only Privy + Connect Wallet; hide email/social form */}
                {/* Email Login Section (disabled) */}
                <form onSubmit={handleEmailLogin} className="hidden">
                  <div className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[rgba(7,10,13,0.8)] text-white placeholder-white/70 rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-sm sm:text-base"
                      required
                    />
                    
                    {/* Additional Sign Up Fields */}
                    {isSignUpMode && email && (
                      <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="Choose a username"
                          className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[rgba(7,10,13,0.8)] text-white placeholder-white/70 rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-sm sm:text-base"
                          required={isSignUpMode}
                        />
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Create a password"
                          className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[rgba(7,10,13,0.8)] text-white placeholder-white/70 rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-sm sm:text-base"
                          required={isSignUpMode}
                          minLength={6}
                        />
                      </div>
                    )}
                    
                    {/* CAPTCHA Component */}
                    {HCAPTCHA_SITE_KEY && !isDevelopment && (
                      <div className="flex justify-center">
                        <HCaptcha
                          ref={captchaRef}
                          sitekey={HCAPTCHA_SITE_KEY}
                          onVerify={(token) => setCaptchaToken(token)}
                          onError={() => setCaptchaToken(null)}
                          onExpire={() => setCaptchaToken(null)}
                          theme="dark"
                          size="normal"
                        />
                      </div>
                    )}
                    
                    {/* Development Mode Indicator */}
                    {isDevelopment && (
                      <div className="flex justify-center">
                        <div className="bg-yellow-600/20 border border-yellow-600/50 rounded-lg px-3 py-2 text-yellow-400 text-sm">
                          🔧 Development Mode: CAPTCHA bypassed
                        </div>
                      </div>
                    )}
                    
                    <button
                      type="submit"
                      disabled={isLoading || !email || (isSignUpMode && (!username || !password)) || (!isDevelopment && !captchaToken)}
                      className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[#872CFF] hover:bg-[#7A25E6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full border border-[#6f00ff] transition-all text-base sm:text-[20px] flex items-center justify-center"
                    >
                      {isLoading ? 'Sending...' : isSignUpMode ? 'Create account' : 'Continue with email'}
                    </button>
                  </div>
                </form>

                {/* Divider - keep a single "or" below Privy section above */}
                <div className="hidden"></div>

                {/* Privy auth controls (after login) */}
                {env.VITE_PRIVY_ENABLED === 'true' && privyReady && privyAuthenticated && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => privyLogout && privyLogout()}
                        className="h-12 sm:h-[50px] px-6 sm:px-[30px] py-2.5 bg-white text-black rounded-full text-base sm:text-[20px]"
                      >
                        Sign out
                      </button>
                      <button
                        type="button"
                        onClick={() => privyLinkWallet && privyLinkWallet()}
                        className="h-12 sm:h-[50px] px-6 sm:px-[30px] py-2.5 bg-black/80 hover:bg-black text-white rounded-full text-base sm:text-[20px]"
                      >
                        Link wallet
                      </button>
                    </div>
                  </div>
                )}

                {/* Social Login Buttons (hidden) */}
                <div className="hidden"></div>
              </>
            )}

            {/* Wallet Connect */}
            <div className="flex flex-col items-center gap-3">
              {WAITLIST_MODE ? (
                // Waitlist mode - only show wallet on login tab
                <>
                  {!isSignUpMode && (
                    <div className="wallet-connect-wrapper">
                      <WalletButton />
                    </div>
                  )}
                  <div className="text-center space-y-2">
                    <p className="text-white/70 text-xs sm:text-sm max-w-xs leading-relaxed">
                      You'll need a Solana Wallet to Send and receive Support
                    </p>
                  </div>
                </>
              ) : (
                // Full login mode - show wallet on both tabs
                <>
                  <div className="wallet-connect-wrapper">
                    <WalletButton />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-white/70 text-xs sm:text-sm max-w-xs leading-relaxed">
                      You'll need a Solana Wallet to Send and receive Support
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Links */}
      <div className="relative z-10 absolute bottom-8 w-full px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between max-w-6xl mx-auto">
          <div className="text-[#bbbbbb] text-xs mb-4 sm:mb-0">
            2025 Hon
          </div>
          
          <div className="flex items-center gap-4">
          </div>
        </div>
      </div>

      {/* Custom styles for wallet button integration */}
      <style jsx>{`
        .wallet-connect-wrapper .wallet-buttons .custom-wallet-button {
          background: white !important;
          color: black !important;
          border-radius: 66px !important;
          height: 50px !important;
          padding: 0 30px !important;
          font-size: 20px !important;
          font-weight: normal !important;
          min-width: 200px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 20px !important;
          transition: all 0.3s ease !important;
        }
        
        .wallet-connect-wrapper .wallet-buttons .custom-wallet-button:hover {
          background: #f0f0f0 !important;
        }
        
        .wallet-connect-wrapper .wallet-connected-container .custom-wallet-button {
          background: white !important;
          color: black !important;
          border-radius: 66px !important;
          height: 50px !important;
          padding: 0 30px !important;
          font-size: 20px !important;
          font-weight: normal !important;
          min-width: 200px !important;
        }
        
        @media (max-width: 640px) {
          .wallet-connect-wrapper .wallet-buttons .custom-wallet-button,
          .wallet-connect-wrapper .wallet-connected-container .custom-wallet-button {
            height: 48px !important;
            font-size: 18px !important;
            min-width: 180px !important;
            padding: 0 24px !important;
          }
        }
      `}</style>
    </div>
  );
} 