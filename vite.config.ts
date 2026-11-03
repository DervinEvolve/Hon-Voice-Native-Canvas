import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { buildCsp, SECURITY_HEADERS } from './csp.config.js'

// Writes the Content Security Policy from csp.config.js into index.html.
function contentSecurityPolicy(): Plugin {
  let dev = false
  return {
    name: 'hon-content-security-policy',
    configResolved(config) { dev = config.command === 'serve' },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const policy = buildCsp({ dev, connectSrc: process.env.VITE_CSP_CONNECT_SRC || '' })
        if (!html.includes('%HON_CSP%')) throw new Error('index.html is missing the %HON_CSP% placeholder')
        return html.replace('%HON_CSP%', policy)
      },
    },
  }
}

// Main Vite configuration
export default defineConfig({
  plugins: [
    react(),
    contentSecurityPolicy()
  ],

  // Reduce noisy output during CI builds and avoid log flooding on Vercel
  logLevel: 'error',

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },

  preview: {
    headers: SECURITY_HEADERS,
  },

  server: {
    headers: SECURITY_HEADERS,
    watch: {
      usePolling: true,
      ignored: [
        '**/tsconfig.json',
        '**/tsconfig.*.json',
        path.resolve(__dirname, 'tsconfig.json')
      ]
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      }
    }
  },

  // Build-time tweaks
  build: {
    // Increase the threshold for chunk size warnings to keep CI output concise
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Filter out known safe annotation warnings from dependencies that spam logs
      onwarn(warning, warn) {
        const message = typeof warning === 'string' ? warning : warning.message;
        if (message && message.includes('/*#__PURE__*/')) {
          return;
        }
        // Forward all other warnings
        // @ts-ignore - Rollup types not available in this context
        warn(warning);
      }
    }
  }
})
