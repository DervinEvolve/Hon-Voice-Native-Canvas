# 🛡️ Environment Variables Security Guide

The complete, current list of variables the code reads is [.env.example](.env.example). This page explains the browser/server split; where the two differ, follow `.env.example`.

## ⚠️ CRITICAL SECURITY WARNING

**Variables with `VITE_` prefix are EXPOSED to the browser!**
Only use `VITE_` for non-sensitive, public configuration.

## ✅ CLIENT-SAFE VARIABLES (Exposed to Browser)

These have `VITE_` prefix and can be seen by users:

```bash
# Supabase Configuration (SAFE - anon key is public by design)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Media Storage (PUBLIC ONLY - no secrets here)
VITE_CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=your-upload-preset

# Solana Configuration (SAFE - public network settings)
VITE_SOLANA_NETWORK=mainnet-beta
VITE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# App Configuration (SAFE - public URLs)
VITE_APP_URL=https://your-domain.com
```

## 🔒 SERVER-SIDE ONLY VARIABLES (NOT exposed to browser)

These do NOT have `VITE_` prefix and stay secure on the server:

```bash
# Media Storage Secrets (SERVER-SIDE ONLY)
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

# AI Service API Keys (SERVER-SIDE ONLY - NEVER add VITE_ prefix!)
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
ELEVENLABS_API_KEY=your-elevenlabs-api-key
FLUX_API_KEY=your-flux-api-key
IDEOGRAM_API_KEY=your-ideogram-api-key
RECRAFT_API_KEY=your-recraft-api-key
KLING_API_KEY=your-kling-api-key
BRIA_API_KEY=your-bria-api-key
HUME_API_KEY=your-hume-api-key
FAL_API_KEY=your-fal-api-key
HUNYUAN3D_API_KEY=your-hunyuan3d-api-key
RUNWAY_API_KEY=your-runway-api-key
LUMA_API_KEY=your-luma-api-key

# Database Secrets (SERVER-SIDE ONLY)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 🔧 SECURITY IMPROVEMENTS

### ✅ Cloudinary Now Secure
- **OLD:** `VITE_CLOUDINARY_API_KEY` exposed in browser ❌
- **NEW:** `CLOUDINARY_API_KEY` server-side only via `/cloudinary-upload` proxy ✅
- **Result:** API key cannot be extracted by attackers

### 🚀 Deployment Instructions

### Vercel Environment Variables

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add CLIENT-SAFE variables (with `VITE_` prefix)
4. Add SERVER-SIDE variables (without `VITE_` prefix)

### Variable Access in Code

```typescript
// ✅ CLIENT-SIDE (components, utils)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// ✅ SERVER-SIDE (API routes only)
const openaiKey = process.env.OPENAI_API_KEY;

// ❌ NEVER DO THIS (exposes API key to browser)
const apiKey = import.meta.env.VITE_OPENAI_API_KEY; // SECURITY BREACH!
```

## 🔍 Security Verification

To verify your setup is secure:

1. Build your app: `npm run build`
2. Check the built files in `dist/` 
3. Search for any API keys - they should NOT appear
4. Only `VITE_` prefixed variables should be visible

## 🛠️ Migration from Insecure Setup

If you previously had API keys with `VITE_` prefix:

1. ✅ Remove `VITE_` prefix from sensitive variables
2. ✅ Update your API routes to use `process.env`
3. ✅ Update Vercel environment variables
4. ✅ Regenerate any exposed API keys
5. ✅ Test that everything still works

---

**Remember**: When in doubt, keep it server-side! It's better to make an extra API call than expose sensitive credentials. 