import { getOrCreateBrowserDeviceKey, signDeviceChallenge } from './deviceKeyManager';

interface DeviceChallengePayload {
  challenge_id?: string;
  challengeId?: string;
  challenge?: string;
}

export async function buildDeviceProof(
  apiBaseUrl: string,
  leaseToken: string,
  clientInstallId: string,
  purpose: 'verify' | 'permit' = 'verify',
) {
  const deviceKey = await getOrCreateBrowserDeviceKey();
  const response = await fetch(`${apiBaseUrl}/v1/lease/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lease_token: leaseToken,
      client_install_id: clientInstallId,
      device_key_id: deviceKey.deviceKeyId,
      purpose,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, `授权设备校验失败：${response.status}`));
  }

  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as DeviceChallengePayload;
  const challengeId = data.challenge_id || data.challengeId;
  if (!challengeId || !data.challenge) {
    throw new Error('服务端未返回授权设备校验请求。');
  }

  const signature = await signDeviceChallenge(data.challenge);
  return {
    device_key_id: signature.deviceKeyId,
    public_key_spki_base64_url: deviceKey.publicKeySpkiBase64Url,
    challenge_id: challengeId,
    challenge: data.challenge,
    signature_base64_url: signature.signatureBase64Url,
    algorithm: signature.algorithm,
    signature_format: signature.signatureFormat,
  };
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: { message?: string } } | null;
    return mapDeviceProofError(payload?.error?.message || payload?.message || fallbackMessage);
  }
  const text = await response.text().catch(() => '');
  return mapDeviceProofError(text.trim() || fallbackMessage);
}

export function mapDeviceProofError(message: string) {
  if (/DEVICE_AUTH_FAILED|DEVICE_|device|signature|public key|challenge|nonce/i.test(message)) {
    return '授权设备验证失败，请重新验证。';
  }
  return message || '授权设备校验失败，请重新验证。';
}
