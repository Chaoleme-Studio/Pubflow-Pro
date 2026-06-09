import { STORAGE_KEYS } from '../types';

interface SecretRecord {
  value: string;
  iv: string;
  updatedAt: number;
}

interface SecretStore {
  version: 1;
  secrets: Record<string, SecretRecord>;
}

const KEY_FORMAT = 'raw';
const KEY_USAGE: KeyUsage[] = ['encrypt', 'decrypt'];
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const LOCAL_KEY_NAME = 'pubflow-secret-key';
const KEY_DB_NAME = 'pubflow-secret-keys';
const KEY_DB_VERSION = 1;
const KEY_STORE_NAME = 'keys';
const MAIN_KEY_ID = 'main';

let cachedKey: CryptoKey | null = null;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredKey(): Promise<CryptoKey | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEY_STORE_NAME, 'readonly');
    const request = transaction.objectStore(KEY_STORE_NAME).get(MAIN_KEY_ID);
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function writeStoredKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEY_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(KEY_STORE_NAME).put(key, MAIN_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const storedKey = await readStoredKey();
  if (storedKey) {
    cachedKey = storedKey;
    return cachedKey;
  }

  const stored = await browser.storage.local.get(LOCAL_KEY_NAME);
  const existing = stored[LOCAL_KEY_NAME] as string | undefined;
  if (existing) {
    cachedKey = await crypto.subtle.importKey(KEY_FORMAT, base64ToBytes(existing), ENCRYPTION_ALGORITHM, false, KEY_USAGE);
    await writeStoredKey(cachedKey);
    await browser.storage.local.remove(LOCAL_KEY_NAME);
    return cachedKey;
  }

  cachedKey = await crypto.subtle.generateKey(
    { name: ENCRYPTION_ALGORITHM, length: 256 },
    false,
    KEY_USAGE,
  );
  await writeStoredKey(cachedKey);
  return cachedKey;
}

async function loadStore(): Promise<SecretStore> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.secrets);
  const store = stored[STORAGE_KEYS.secrets] as SecretStore | undefined;
  if (store?.version === 1 && store.secrets && typeof store.secrets === 'object') return store;
  return { version: 1, secrets: {} };
}

async function saveStore(store: SecretStore) {
  await browser.storage.local.set({ [STORAGE_KEYS.secrets]: store });
}

export async function loadSecret(secretId: string): Promise<string> {
  const store = await loadStore();
  const record = store.secrets[secretId];
  if (!record?.value || !record.iv) return '';

  const key = await getOrCreateKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.value),
  );
  return new TextDecoder().decode(decrypted);
}

export async function saveSecret(secretId: string, value: string) {
  const store = await loadStore();
  if (!value) {
    delete store.secrets[secretId];
    await saveStore(store);
    return;
  }

  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    new TextEncoder().encode(value),
  );

  store.secrets[secretId] = {
    value: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    updatedAt: Date.now(),
  };
  await saveStore(store);
}

export async function pruneSecrets(prefix: string, keepSecretIds: Set<string>) {
  const store = await loadStore();
  let changed = false;
  for (const secretId of Object.keys(store.secrets)) {
    if (secretId.startsWith(prefix) && !keepSecretIds.has(secretId)) {
      delete store.secrets[secretId];
      changed = true;
    }
  }
  if (changed) {
    await saveStore(store);
  }
}
