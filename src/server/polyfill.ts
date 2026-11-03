// Polyfill for util.inspect to avoid the error with object-inspect
import { inspect } from 'util';

// Make util.inspect available in the module
// This is needed because some packages like object-inspect try to require './util.inspect'
(globalThis as any).util = {
  inspect: inspect
};

export {}; 