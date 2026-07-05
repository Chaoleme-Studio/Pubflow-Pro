const DEVICE_KEY_DB_NAME = 'pubflow-device-keys';
const DEVICE_KEY_DB_VERSION = 1;
const DEVICE_KEY_STORE_NAME = 'keys';
const DEVICE_KEY_ID = 'browser-profile-p256-v1';
const DEVICE_KEY_ALGORITHM = 'ECDSA';
const DEVICE_KEY_NAMED_CURVE = 'P-256';
const DEVICE_KEY_HASH_ALGORITHM = 'SHA-256';

interface StoredDeviceKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  createdAt: number;
}

export interface BrowserDeviceKeyInfo {
  algorithm: 'ECDSA_P256_SHA256';
  deviceKeyId: string;
  publicKeySpkiBase64Url: string;
  publicKeyJwk: JsonWebKey;
  createdAt: number;
}

export interface DeviceChallengeSignature {
  algorithm: 'ECDSA_P256_SHA256';
  signatureFormat: 'webcrypto-p1363';
  deviceKeyId: string;
  challenge: string;
  signatureBase64Url: string;
}

export async function getOrCreateBrowserDeviceKey(): Promise<BrowserDeviceKeyInfo> {
  const keyPair = await readStoredKeyPair() || await createAndStoreKeyPair();
  return describeKeyPair(keyPair);
}

export async function signDeviceChallenge(challenge: string): Promise<DeviceChallengeSignature> {
  if (!challenge.trim()) {
    throw new Error('授权校验请求无效，请重新验证。');
  }

  const keyPair = await readStoredKeyPair() || await createAndStoreKeyPair();
  const info = await describeKeyPair(keyPair);
  const signature = await crypto.subtle.sign(
    { name: DEVICE_KEY_ALGORITHM, hash: DEVICE_KEY_HASH_ALGORITHM },
    keyPair.privateKey,
    new TextEncoder().encode(challenge),
  );

  return {
    algorithm: 'ECDSA_P256_SHA256',
    signatureFormat: 'webcrypto-p1363',
    deviceKeyId: info.deviceKeyId,
    challenge,
    signatureBase64Url: bytesToBase64Url(new Uint8Array(signature)),
  };
}

async function createAndStoreKeyPair(): Promise<StoredDeviceKeyPair> {
  const generated = await crypto.subtle.generateKey(
    {
      name: DEVICE_KEY_ALGORITHM,
      namedCurve: DEVICE_KEY_NAMED_CURVE,
    },
    false,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const keyPair: StoredDeviceKeyPair = {
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    createdAt: Date.now(),
  };
  await writeStoredKeyPair(keyPair);
  return keyPair;
}

async function describeKeyPair(keyPair: StoredDeviceKeyPair): Promise<BrowserDeviceKeyInfo> {
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const publicKeyHash = new Uint8Array(await crypto.subtle.digest(DEVICE_KEY_HASH_ALGORITHM, publicKeySpki));
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    algorithm: 'ECDSA_P256_SHA256',
    deviceKeyId: `p256:${bytesToBase64Url(publicKeyHash)}`,
    publicKeySpkiBase64Url: bytesToBase64Url(publicKeySpki),
    publicKeyJwk,
    createdAt: keyPair.createdAt,
  };
}

function openDeviceKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_KEY_DB_NAME, DEVICE_KEY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_KEY_STORE_NAME)) {
        db.createObjectStore(DEVICE_KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredKeyPair(): Promise<StoredDeviceKeyPair | null> {
  const db = await openDeviceKeyDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DEVICE_KEY_STORE_NAME, 'readonly');
    const request = transaction.objectStore(DEVICE_KEY_STORE_NAME).get(DEVICE_KEY_ID);
    request.onsuccess = () => resolve((request.result as StoredDeviceKeyPair | undefined) || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function writeStoredKeyPair(keyPair: StoredDeviceKeyPair): Promise<void> {
  const db = await openDeviceKeyDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DEVICE_KEY_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(DEVICE_KEY_STORE_NAME).put(keyPair, DEVICE_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
