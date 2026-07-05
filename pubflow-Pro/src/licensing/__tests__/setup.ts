import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

if (!globalThis.btoa) {
  globalThis.btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
}

if (!globalThis.atob) {
  globalThis.atob = (value: string) => Buffer.from(value, 'base64').toString('binary');
}

const testGlobal = globalThis as typeof globalThis & { browser?: unknown };

if (!testGlobal.browser) {
  testGlobal.browser = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
    },
  };
}
