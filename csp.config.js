// Content Security Policy for the canvas page. vite.config.ts writes it into
// index.html at build and dev time; tests/csp.test.mjs checks it.
//
// Each host is here because code in this repository, or an SDK it loads,
// needs it. Add a host only together with the code that needs it.

// Scripts. No blanket https: source.
export const SCRIPT_HOSTS = [
  'https://unpkg.com/@google/model-viewer@3.4.0/', // index.html, pinned with SRI
  'https://unpkg.com/three@0.160.0/',              // generated games: IframeGameViewer.tsx (sandboxed srcdoc frame)
  'https://unpkg.com/three@0.158.0/',              // generated games: GameViewer.tsx worker importScripts
  'https://maps.googleapis.com',                   // googleMaps3d.ts loader
  'https://maps.gstatic.com',                      // Google Maps JS modules
  'https://hcaptcha.com', 'https://*.hcaptcha.com', // Login.tsx captcha
  'https://challenges.cloudflare.com',             // Privy sign-in challenge
];

// Frames the page may embed.
export const FRAME_HOSTS = [
  'https://auth.privy.io',                         // Privy sign-in
  'https://verify.walletconnect.com', 'https://verify.walletconnect.org',
  'https://challenges.cloudflare.com',
  'https://hcaptcha.com', 'https://*.hcaptcha.com',
];

// WebSocket endpoints. https: below does not cover wss:.
export const SOCKET_HOSTS = [
  'wss://api.hume.ai',                             // EVI speech-to-speech
  'wss://*.supabase.co',                           // Supabase realtime
  'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org', 'wss://www.walletlink.org',
  'wss://api.mainnet-beta.solana.com', 'wss://api.devnet.solana.com',
];

export const STYLE_HOSTS = ['https://fonts.googleapis.com', 'https://hcaptcha.com', 'https://*.hcaptcha.com'];
export const FONT_HOSTS = ['https://fonts.gstatic.com'];

// connect-src, img-src and media-src still allow any https host: the canvas
// fetches and shows generated media from provider CDNs whose hosts come back
// at runtime (src/hooks/useMediaLoader.ts and others). Set
// VITE_CSP_CONNECT_SRC to a space-separated host list at build time to
// replace `https:` in connect-src once the hosts you use are known.
export function buildCsp({ dev = false, connectSrc = '' } = {}) {
  const connect = connectSrc.trim() ? connectSrc.trim().split(/\s+/) : ['https:'];
  const directives = {
    'default-src': ["'self'"],
    // 'unsafe-inline': generated games run inline code in a sandboxed srcdoc
    // frame, which inherits this policy. 'unsafe-eval': the voice scene
    // builder (off unless VITE_ENABLE_SCENE_CODE_EXECUTION=true) and Google Maps.
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', ...SCRIPT_HOSTS],
    'worker-src': ["'self'", 'blob:'],
    'style-src': ["'self'", "'unsafe-inline'", ...STYLE_HOSTS],
    'font-src': ["'self'", 'data:', ...FONT_HOSTS],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", 'data:', 'blob:', ...connect, ...SOCKET_HOSTS, ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : [])],
    'frame-src': ["'self'", 'blob:', ...FRAME_HOSTS],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

// Response headers for the deployed site and the local servers. frame-ancestors
// only works as a header, so it lives here rather than in the meta policy.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
