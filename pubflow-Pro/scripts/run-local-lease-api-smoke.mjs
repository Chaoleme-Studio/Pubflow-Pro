import { createHash, webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[i + 1]?.startsWith('--') ? '1' : process.argv[i + 1] || '1');
    if (args.get(arg) !== '1') i += 1;
  }
}

const apiBaseUrl = String(args.get('--api') || process.env.PUBFLOW_LICENSE_API_BASE_URL || 'http://127.0.0.1:5189').replace(/\/+$/, '');
let activationCode = String(args.get('--code') || process.env.PUBFLOW_ACTIVATION_CODE || demoActivationCode('creator@northlab.cn')).trim().toUpperCase();
const clientInstallId = String(args.get('--install') || `api-smoke-${Date.now()}`);
const platform = String(args.get('--platform') || process.platform);
const packageVersion = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')).version;
const extensionVersion = String(args.get('--extension-version') || packageVersion);
const shouldGenerateLicense = args.get('--generate-license') === '1';
const serverEnvPath = resolve(rootDir, args.get('--server-env') || '../.env.development');

let keyPair;
let publicKeySpki;
let deviceKeyId;
let publicKeySpkiBase64Url;

try {
  await main();
} catch (error) {
  console.error(`Lease API smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function main() {
  keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  publicKeySpki = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey));
  deviceKeyId = `p256:${base64Url(new Uint8Array(await subtle.digest('SHA-256', publicKeySpki)))}`;
  publicKeySpkiBase64Url = base64Url(publicKeySpki);

  console.log(`Lease API smoke target: ${apiBaseUrl}`);
  if (shouldGenerateLicense) {
    activationCode = await generateTemporaryLicense();
  }
  console.log(`Activation code: ${activationCode}`);
  console.log(`Client install id: ${clientInstallId}`);

  const activateProof = await buildDeviceProof(undefined, 'verify');
  const activated = await postJson('/v1/lease/activate', {
    activation_code: activationCode,
    client_install_id: clientInstallId,
    machine_hash: null,
    platform,
    extension_version: extensionVersion,
    device_proof: activateProof,
  });
  const leaseToken = activated.lease_token || activated.leaseToken;
  if (!leaseToken) throw new Error('Activation did not return lease token');

  const verifyProof = await buildDeviceProof(leaseToken, 'verify');
  const verified = await postJson('/v1/lease/verify', {
    lease_token: leaseToken,
    client_install_id: clientInstallId,
    machine_hash: null,
    device_proof: verifyProof,
  });
  if (verified.valid !== true || verified.status !== 'active') {
    throw new Error(`Verify failed: ${JSON.stringify(verified)}`);
  }

  const permitProof = await buildDeviceProof(leaseToken, 'permit');
  const permit = await postJson('/v1/lease/permit', {
    lease_token: leaseToken,
    client_install_id: clientInstallId,
    machine_hash: null,
    operation: 'start_distribution',
    task_hash: `sha256:${base64Url(new Uint8Array(await subtle.digest('SHA-256', encoder.encode(clientInstallId))))}`,
    device_proof: permitProof,
  });
  if (!(permit.permit_token || permit.permitToken) || !(permit.permit_id || permit.permitId)) {
    throw new Error(`Permit failed: ${JSON.stringify(permit)}`);
  }

  console.log('Lease API smoke passed');
  console.log(JSON.stringify({
    activationCode,
    clientInstallId,
    deviceKeyId,
    leaseValidUntil: activated.valid_until || activated.validUntil,
    verifyStatus: verified.status,
    permitId: permit.permit_id || permit.permitId,
    permitExpiresAt: permit.expires_at || permit.expiresAt,
  }, null, 2));
}

async function generateTemporaryLicense() {
  const serverEnv = readEnvFile(serverEnvPath);
  const username = process.env.ADMIN_USERNAME || serverEnv.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD || serverEnv.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(`--generate-license requires ADMIN_USERNAME and ADMIN_PASSWORD, or a readable server env file: ${serverEnvPath}`);
  }
  const login = await postJson('/v1/admin/login', { username, password });
  const token = login.token;
  if (!token) throw new Error('Admin login did not return token');
  const generated = await postJson('/v1/admin/licenses/generate', {
    plan: 'monthly',
    quantity: 1,
    max_devices: 1,
    batch_name: `manual-security-api-smoke-${new Date().toISOString()}`,
    sales_channel: 'manual_security_smoke',
  }, token);
  const code = generated.items?.[0]?.activation_code || generated.items?.[0]?.activationCode;
  if (!code) throw new Error(`Admin generate did not return activation code: ${JSON.stringify(generated)}`);
  return String(code).trim().toUpperCase();
}

async function buildDeviceProof(leaseToken, purpose) {
  const challenge = await postJson('/v1/lease/challenge', {
    lease_token: leaseToken || null,
    client_install_id: clientInstallId,
    device_key_id: deviceKeyId,
    purpose,
  });
  const challengeId = challenge.challenge_id || challenge.challengeId;
  if (!challengeId || !challenge.challenge) {
    throw new Error(`Challenge response missing fields: ${JSON.stringify(challenge)}`);
  }
  const signature = normalizeEcdsaP1363(new Uint8Array(await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    encoder.encode(challenge.challenge),
  )));
  const locallyVerified = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.publicKey,
    signature,
    encoder.encode(challenge.challenge),
  );
  if (!locallyVerified) {
    throw new Error(`Local ECDSA verification failed for ${purpose} challenge`);
  }
  return {
    device_key_id: deviceKeyId,
    public_key_spki_base64_url: publicKeySpkiBase64Url,
    challenge_id: challengeId,
    challenge: challenge.challenge,
    signature_base64_url: base64Url(signature),
    algorithm: 'ECDSA_P256_SHA256',
    signature_format: 'webcrypto-p1363',
  };
}

function normalizeEcdsaP1363(signature) {
  if (signature.byteLength === 64) return signature;
  if (signature[0] !== 0x30) {
    throw new Error(`Unsupported ECDSA signature format, ${signature.byteLength} bytes`);
  }
  let offset = 2;
  if (signature[1] & 0x80) {
    const lengthBytes = signature[1] & 0x7f;
    offset = 2 + lengthBytes;
  }
  if (signature[offset] !== 0x02) throw new Error('Invalid DER ECDSA signature: missing r');
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error('Invalid DER ECDSA signature: missing s');
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  return concatFixedInteger(r, s);
}

function concatFixedInteger(r, s) {
  const out = new Uint8Array(64);
  out.set(trimAndPadInteger(r), 0);
  out.set(trimAndPadInteger(s), 32);
  return out;
}

function trimAndPadInteger(value) {
  let bytes = value;
  while (bytes.length > 32 && bytes[0] === 0) {
    bytes = bytes.slice(1);
  }
  if (bytes.length > 32) throw new Error('ECDSA integer is longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

async function postJson(path, body, bearerToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload.data ?? payload;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function demoActivationCode(email) {
  const digest = createHash('sha256')
    .update('pubflow-demo-seed')
    .update(':')
    .update(email)
    .digest('hex');
  return `PF-${digest.slice(0, 16).toUpperCase()}`;
}
