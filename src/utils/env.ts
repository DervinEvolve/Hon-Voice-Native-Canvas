/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Supabase Configuration (SAFE - anon key is meant to be public)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  
  // Media Storage (PUBLIC ONLY - no secrets)
  readonly VITE_CLOUDINARY_CLOUD_NAME: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET: string;
  // NOTE: CLOUDINARY_API_SECRET should NOT have VITE_ prefix - it's server-side only
  
  // Solana Configuration (SAFE - public network settings)
  readonly VITE_SOLANA_NETWORK: string;
  readonly VITE_SOLANA_RPC_URL: string;
  
  // App Configuration (SAFE - public settings)
  readonly VITE_APP_URL: string;
  // Feature flags
  readonly VITE_PRIVY_ENABLED?: string; // 'true' to enable Privy
  // Privy (public app id)
  readonly VITE_PRIVY_APP_ID?: string;
  // Waitlist (public flag)
  readonly VITE_WAITLIST_MODE?: string; // 'true' to enable waitlist UI
  
  // NOTE: All AI service API keys should NOT have VITE_ prefix
  // They should be server-side only and accessed via API routes
}

function validateEnv(): ImportMetaEnv {
  const env = import.meta.env;

  // Critical variables required for production (CLIENT-SAFE ONLY)
  const criticalVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_CLOUDINARY_CLOUD_NAME',
    'VITE_CLOUDINARY_UPLOAD_PRESET'
  ];

  // Optional public configuration
  const optionalVars = [
    'VITE_SOLANA_NETWORK',
    'VITE_SOLANA_RPC_URL',
    'VITE_APP_URL',
    'VITE_PRIVY_ENABLED',
    'VITE_PRIVY_APP_ID',
    'VITE_WAITLIST_MODE'
  ];

  console.log('🔧 Environment Configuration Status:');
  
  // Check critical variables
  console.log('\n📍 Critical Variables (Client-Safe):');
  let missingCritical = 0;
  criticalVars.forEach(key => {
    const isConfigured = !!env[key];
    console.log(`${isConfigured ? '✅' : '❌'} ${key} is ${isConfigured ? 'configured' : 'MISSING'}`);
    if (!isConfigured) missingCritical++;
  });

  // Check optional variables
  console.log('\n🔧 Optional Variables (Public Configuration):');
  optionalVars.forEach(key => {
    const isConfigured = !!env[key];
    console.log(`${isConfigured ? '✅' : '⚠️'} ${key} is ${isConfigured ? 'configured' : 'not configured'}`);
  });

  // Security warning about API keys
  console.log('\n🛡️ Security Note:');
  console.log('🔒 AI service API keys are server-side only (no VITE_ prefix)');
  console.log('🔒 Sensitive operations handled via secure API routes');

  // Warn if critical variables are missing
  if (missingCritical > 0) {
    console.warn(`⚠️ ${missingCritical} critical environment variables are missing!`);
    console.warn('The application may not function properly.');
  }

  // Return environment variables with fallbacks (CLIENT-SAFE ONLY)
  return {
    // Supabase (anon key is designed to be public)
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY || '',
    
    // Media Storage (public settings only)
    VITE_CLOUDINARY_CLOUD_NAME: env.VITE_CLOUDINARY_CLOUD_NAME || '',
    VITE_CLOUDINARY_UPLOAD_PRESET: env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
    
    // Solana (public network settings)
    VITE_SOLANA_NETWORK: env.VITE_SOLANA_NETWORK || 'mainnet-beta',
    VITE_SOLANA_RPC_URL: env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    
    // App settings
    VITE_APP_URL: env.VITE_APP_URL || 'http://localhost:5173',
    // Privy
    VITE_PRIVY_ENABLED: env.VITE_PRIVY_ENABLED || 'false',
    VITE_PRIVY_APP_ID: env.VITE_PRIVY_APP_ID,
    VITE_WAITLIST_MODE: env.VITE_WAITLIST_MODE || 'false'
  };
}

export const env = validateEnv();