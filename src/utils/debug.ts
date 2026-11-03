/**
 * Debug logging utility
 * Only logs in development mode to reduce console spam in production
 */

const isDev = import.meta.env.DEV;

export const debug = {
  log: (...args: any[]) => {
    if (isDev) console.log(...args);
  },

  warn: (...args: any[]) => {
    // Always show warnings
    console.warn(...args);
  },

  error: (...args: any[]) => {
    // Always show errors
    console.error(...args);
  },

  info: (...args: any[]) => {
    if (isDev) console.info(...args);
  }
};
