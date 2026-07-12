//! PubFlow Selector Protocol (PFSP) v1.
//!
//! This is a compact binary envelope for selector fetches. It is not a raw TCP
//! protocol; browser extensions still send it over HTTPS. The value is that the
//! application payload is non-JSON, authenticated, replay-bound, and encrypted
//! with per-request keys derived from X25519 ECDH plus request context.

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use curve25519_dalek::montgomery::MontgomeryPoint;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAGIC: &[u8; 4] = b"PFSP";
pub const VERSION: u8 = 1;
pub const HEADER_LEN: usize = 4 + 1 + 1 + 8 + 12 + 32 + 4;
const NONCE_LEN: usize = 12;
const CLIENT_RANDOM_LEN: usize = 32;
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectorProtocolRequestPayload {
    pub lease_token: String,
    pub client_install_id: String,
    pub activation_code_hash: String,
    pub selector_version_known: Option<i32>,
    pub extension_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivationProtocolRequestPayload {
    pub activation_code: String,
    pub client_install_id: String,
    pub platform: String,
    pub extension_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivationProtocolResponsePayload {
    pub lease_token: String,
    pub lease_type: String,
    pub tier: String,
    pub features: Vec<String>,
    pub valid_from: i64,
    pub valid_until: i64,
    #[serde(default)]
    pub license_expires_at: Option<i64>,
    pub server_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectorProtocolResponsePayload {
    pub version: i32,
    pub encrypted_selector_blob: String,
    pub checksum: String,
    pub min_app_version: String,
    pub expires_at: Option<i64>,
    pub server_time: i64,
}

#[derive(Debug, Clone)]
pub struct DecodedSelectorRequest {
    pub payload: SelectorProtocolRequestPayload,
    pub client_nonce: [u8; NONCE_LEN],
    pub timestamp_ms: i64,
    pub client_public_key: [u8; CLIENT_RANDOM_LEN],
    response_key: [u8; KEY_LEN],
}

#[derive(Debug, Clone)]
pub struct DecodedActivationRequest {
    pub payload: ActivationProtocolRequestPayload,
    pub client_nonce: [u8; NONCE_LEN],
    pub timestamp_ms: i64,
    pub client_public_key: [u8; CLIENT_RANDOM_LEN],
    response_key: [u8; KEY_LEN],
}

impl DecodedActivationRequest {
    pub fn response_key(&self) -> [u8; KEY_LEN] {
        self.response_key
    }
}

impl DecodedSelectorRequest {
    pub fn response_key(&self) -> [u8; KEY_LEN] {
        self.response_key
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ClientSession {
    pub timestamp_ms: i64,
    pub client_nonce: [u8; NONCE_LEN],
    pub client_public_key: [u8; CLIENT_RANDOM_LEN],
    request_key: [u8; KEY_LEN],
    response_key: [u8; KEY_LEN],
}

impl ClientSession {
    pub fn response_key(&self) -> [u8; KEY_LEN] {
        self.response_key
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SelectorProtocolError {
    #[error("PFSP_BAD_MAGIC")]
    BadMagic,
    #[error("PFSP_UNSUPPORTED_VERSION")]
    UnsupportedVersion,
    #[error("PFSP_BAD_LENGTH")]
    BadLength,
    #[error("PFSP_DECRYPT_FAILED")]
    DecryptFailed,
    #[error("PFSP_ENCRYPT_FAILED")]
    EncryptFailed,
    #[error("PFSP_SERIALIZE_FAILED")]
    SerializeFailed,
    #[error("PFSP_BAD_KEY")]
    BadKey,
}

pub fn activation_code_hash(activation_code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(activation_code.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn server_public_key_hex(
    server_private_key_hex: &str,
) -> Result<String, SelectorProtocolError> {
    Ok(hex::encode(public_key_from_private(&key_from_hex(
        server_private_key_hex,
    )?)))
}

pub fn generate_server_private_key_hex() -> String {
    let mut key = [0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    hex::encode(key)
}

pub fn start_client_session(
    server_public_key_hex: &str,
    timestamp_ms: i64,
    context: &str,
) -> Result<ClientSession, SelectorProtocolError> {
    let server_public = key_from_hex(server_public_key_hex)?;
    let mut client_nonce = [0u8; NONCE_LEN];
    let mut client_private_key = [0u8; CLIENT_RANDOM_LEN];
    rand::rngs::OsRng.fill_bytes(&mut client_nonce);
    rand::rngs::OsRng.fill_bytes(&mut client_private_key);
    let client_public_key = public_key_from_private(&client_private_key);
    let shared_secret = ecdh(&client_private_key, &server_public)?;
    let (request_key, response_key) = derive_keys(
        &shared_secret,
        &server_public,
        &client_nonce,
        &client_public_key,
        context,
    );

    Ok(ClientSession {
        timestamp_ms,
        client_nonce,
        client_public_key,
        request_key,
        response_key,
    })
}

pub fn encode_request(
    payload: &SelectorProtocolRequestPayload,
    session: &ClientSession,
) -> Result<Vec<u8>, SelectorProtocolError> {
    encode_payload_request(payload, session)
}

pub fn encode_activation_request(
    payload: &ActivationProtocolRequestPayload,
    session: &ClientSession,
) -> Result<Vec<u8>, SelectorProtocolError> {
    encode_payload_request(payload, session)
}

fn encode_payload_request<T: Serialize>(
    payload: &T,
    session: &ClientSession,
) -> Result<Vec<u8>, SelectorProtocolError> {
    let plaintext =
        serde_json::to_vec(payload).map_err(|_| SelectorProtocolError::SerializeFailed)?;
    let mut header = encode_header(
        session.timestamp_ms,
        &session.client_nonce,
        &session.client_public_key,
        0,
    );
    let ciphertext = encrypt(
        &session.request_key,
        &session.client_nonce,
        &plaintext,
        &header,
    )?;
    write_ciphertext_len(&mut header, ciphertext.len())?;

    let mut output = header;
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decode_request(
    bytes: &[u8],
    server_private_key_hex: &str,
    context: &str,
) -> Result<DecodedSelectorRequest, SelectorProtocolError> {
    let parsed = parse_header(bytes)?;
    let server_private = key_from_hex(server_private_key_hex)?;
    let server_public = public_key_from_private(&server_private);
    let shared_secret = ecdh(&server_private, &parsed.client_public_key)?;
    let (request_key, response_key) = derive_keys(
        &shared_secret,
        &server_public,
        &parsed.client_nonce,
        &parsed.client_public_key,
        context,
    );
    let ciphertext = &bytes[HEADER_LEN..];
    if ciphertext.len() != parsed.ciphertext_len {
        return Err(SelectorProtocolError::BadLength);
    }
    let mut aad = bytes[..HEADER_LEN].to_vec();
    aad[HEADER_LEN - 4..].fill(0);
    let plaintext = decrypt(&request_key, &parsed.client_nonce, ciphertext, &aad)?;
    let payload =
        serde_json::from_slice(&plaintext).map_err(|_| SelectorProtocolError::DecryptFailed)?;

    Ok(DecodedSelectorRequest {
        payload,
        client_nonce: parsed.client_nonce,
        timestamp_ms: parsed.timestamp_ms,
        client_public_key: parsed.client_public_key,
        response_key,
    })
}

pub fn decode_activation_request(
    bytes: &[u8],
    server_private_key_hex: &str,
    context: &str,
) -> Result<DecodedActivationRequest, SelectorProtocolError> {
    let parsed = parse_header(bytes)?;
    let server_private = key_from_hex(server_private_key_hex)?;
    let server_public = public_key_from_private(&server_private);
    let shared_secret = ecdh(&server_private, &parsed.client_public_key)?;
    let (request_key, response_key) = derive_keys(
        &shared_secret,
        &server_public,
        &parsed.client_nonce,
        &parsed.client_public_key,
        context,
    );
    let ciphertext = &bytes[HEADER_LEN..];
    if ciphertext.len() != parsed.ciphertext_len {
        return Err(SelectorProtocolError::BadLength);
    }
    let mut aad = bytes[..HEADER_LEN].to_vec();
    aad[HEADER_LEN - 4..].fill(0);
    let plaintext = decrypt(&request_key, &parsed.client_nonce, ciphertext, &aad)?;
    let payload =
        serde_json::from_slice(&plaintext).map_err(|_| SelectorProtocolError::DecryptFailed)?;

    Ok(DecodedActivationRequest {
        payload,
        client_nonce: parsed.client_nonce,
        timestamp_ms: parsed.timestamp_ms,
        client_public_key: parsed.client_public_key,
        response_key,
    })
}

pub fn encode_response(
    payload: &SelectorProtocolResponsePayload,
    response_key: &[u8; KEY_LEN],
) -> Result<Vec<u8>, SelectorProtocolError> {
    encode_payload_response(payload, response_key)
}

pub fn encode_activation_response(
    payload: &ActivationProtocolResponsePayload,
    response_key: &[u8; KEY_LEN],
) -> Result<Vec<u8>, SelectorProtocolError> {
    encode_payload_response(payload, response_key)
}

fn encode_payload_response<T: Serialize>(
    payload: &T,
    response_key: &[u8; KEY_LEN],
) -> Result<Vec<u8>, SelectorProtocolError> {
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let plaintext =
        serde_json::to_vec(payload).map_err(|_| SelectorProtocolError::SerializeFailed)?;
    let ciphertext = encrypt(response_key, &nonce, &plaintext, b"PFSP-response-v1")?;

    let mut output = Vec::with_capacity(1 + NONCE_LEN + 4 + ciphertext.len());
    output.push(VERSION);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&(ciphertext.len() as u32).to_be_bytes());
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decode_response(
    bytes: &[u8],
    response_key: &[u8; KEY_LEN],
) -> Result<SelectorProtocolResponsePayload, SelectorProtocolError> {
    if bytes.len() < 1 + NONCE_LEN + 4 {
        return Err(SelectorProtocolError::BadLength);
    }
    if bytes[0] != VERSION {
        return Err(SelectorProtocolError::UnsupportedVersion);
    }
    let nonce: [u8; NONCE_LEN] = bytes[1..1 + NONCE_LEN]
        .try_into()
        .map_err(|_| SelectorProtocolError::BadLength)?;
    let len_offset = 1 + NONCE_LEN;
    let ciphertext_len = u32::from_be_bytes(
        bytes[len_offset..len_offset + 4]
            .try_into()
            .map_err(|_| SelectorProtocolError::BadLength)?,
    ) as usize;
    let ciphertext = &bytes[len_offset + 4..];
    if ciphertext.len() != ciphertext_len {
        return Err(SelectorProtocolError::BadLength);
    }
    let plaintext = decrypt(response_key, &nonce, ciphertext, b"PFSP-response-v1")?;
    serde_json::from_slice(&plaintext).map_err(|_| SelectorProtocolError::DecryptFailed)
}

pub fn decode_activation_response(
    bytes: &[u8],
    response_key: &[u8; KEY_LEN],
) -> Result<ActivationProtocolResponsePayload, SelectorProtocolError> {
    if bytes.len() < 1 + NONCE_LEN + 4 {
        return Err(SelectorProtocolError::BadLength);
    }
    if bytes[0] != VERSION {
        return Err(SelectorProtocolError::UnsupportedVersion);
    }
    let nonce: [u8; NONCE_LEN] = bytes[1..1 + NONCE_LEN]
        .try_into()
        .map_err(|_| SelectorProtocolError::BadLength)?;
    let len_offset = 1 + NONCE_LEN;
    let ciphertext_len = u32::from_be_bytes(
        bytes[len_offset..len_offset + 4]
            .try_into()
            .map_err(|_| SelectorProtocolError::BadLength)?,
    ) as usize;
    let ciphertext = &bytes[len_offset + 4..];
    if ciphertext.len() != ciphertext_len {
        return Err(SelectorProtocolError::BadLength);
    }
    let plaintext = decrypt(response_key, &nonce, ciphertext, b"PFSP-response-v1")?;
    serde_json::from_slice(&plaintext).map_err(|_| SelectorProtocolError::DecryptFailed)
}

pub fn client_nonce_hex(client_nonce: &[u8; NONCE_LEN]) -> String {
    hex::encode(client_nonce)
}

fn public_key_from_private(private_key: &[u8; KEY_LEN]) -> [u8; KEY_LEN] {
    MontgomeryPoint::mul_base_clamped(*private_key).0
}

fn ecdh(
    private_key: &[u8; KEY_LEN],
    peer_public_key: &[u8; KEY_LEN],
) -> Result<[u8; KEY_LEN], SelectorProtocolError> {
    let shared = MontgomeryPoint(*peer_public_key)
        .mul_clamped(*private_key)
        .0;
    if shared.iter().all(|byte| *byte == 0) {
        return Err(SelectorProtocolError::BadKey);
    }
    Ok(shared)
}

fn derive_keys(
    shared_secret: &[u8; KEY_LEN],
    server_public_key: &[u8; KEY_LEN],
    client_nonce: &[u8; NONCE_LEN],
    client_public_key: &[u8; CLIENT_RANDOM_LEN],
    context: &str,
) -> ([u8; KEY_LEN], [u8; KEY_LEN]) {
    let request_key = derive_one_key(
        b"pubflow-pfsp-v1-request",
        shared_secret,
        server_public_key,
        client_nonce,
        client_public_key,
        context,
    );
    let response_key = derive_one_key(
        b"pubflow-pfsp-v1-response",
        shared_secret,
        server_public_key,
        client_nonce,
        client_public_key,
        context,
    );
    (request_key, response_key)
}

fn derive_one_key(
    label: &[u8],
    shared_secret: &[u8; KEY_LEN],
    server_public_key: &[u8; KEY_LEN],
    client_nonce: &[u8; NONCE_LEN],
    client_public_key: &[u8; CLIENT_RANDOM_LEN],
    context: &str,
) -> [u8; KEY_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(label);
    hasher.update(shared_secret);
    hasher.update(server_public_key);
    hasher.update(client_nonce);
    hasher.update(client_public_key);
    hasher.update(context.as_bytes());
    hasher.finalize().into()
}

fn encrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, SelectorProtocolError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| SelectorProtocolError::BadKey)?;
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| SelectorProtocolError::EncryptFailed)
}

fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, SelectorProtocolError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| SelectorProtocolError::BadKey)?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| SelectorProtocolError::DecryptFailed)
}

struct ParsedHeader {
    timestamp_ms: i64,
    client_nonce: [u8; NONCE_LEN],
    client_public_key: [u8; CLIENT_RANDOM_LEN],
    ciphertext_len: usize,
}

fn encode_header(
    timestamp_ms: i64,
    client_nonce: &[u8; NONCE_LEN],
    client_public_key: &[u8; CLIENT_RANDOM_LEN],
    ciphertext_len: usize,
) -> Vec<u8> {
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(VERSION);
    header.push(0);
    header.extend_from_slice(&timestamp_ms.to_be_bytes());
    header.extend_from_slice(client_nonce);
    header.extend_from_slice(client_public_key);
    header.extend_from_slice(&(ciphertext_len as u32).to_be_bytes());
    header
}

fn write_ciphertext_len(
    header: &mut [u8],
    ciphertext_len: usize,
) -> Result<(), SelectorProtocolError> {
    if header.len() != HEADER_LEN || ciphertext_len > u32::MAX as usize {
        return Err(SelectorProtocolError::BadLength);
    }
    header[HEADER_LEN - 4..].copy_from_slice(&(ciphertext_len as u32).to_be_bytes());
    Ok(())
}

fn parse_header(bytes: &[u8]) -> Result<ParsedHeader, SelectorProtocolError> {
    if bytes.len() < HEADER_LEN {
        return Err(SelectorProtocolError::BadLength);
    }
    if &bytes[..4] != MAGIC {
        return Err(SelectorProtocolError::BadMagic);
    }
    if bytes[4] != VERSION {
        return Err(SelectorProtocolError::UnsupportedVersion);
    }
    let timestamp_ms = i64::from_be_bytes(
        bytes[6..14]
            .try_into()
            .map_err(|_| SelectorProtocolError::BadLength)?,
    );
    let client_nonce = bytes[14..26]
        .try_into()
        .map_err(|_| SelectorProtocolError::BadLength)?;
    let client_public_key = bytes[26..58]
        .try_into()
        .map_err(|_| SelectorProtocolError::BadLength)?;
    let ciphertext_len = u32::from_be_bytes(
        bytes[58..62]
            .try_into()
            .map_err(|_| SelectorProtocolError::BadLength)?,
    ) as usize;
    Ok(ParsedHeader {
        timestamp_ms,
        client_nonce,
        client_public_key,
        ciphertext_len,
    })
}

fn key_from_hex(value: &str) -> Result<[u8; KEY_LEN], SelectorProtocolError> {
    let bytes = hex::decode(value.trim()).map_err(|_| SelectorProtocolError::BadKey)?;
    bytes.try_into().map_err(|_| SelectorProtocolError::BadKey)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selector_protocol_roundtrip() {
        let server_private = generate_server_private_key_hex();
        let server_public = server_public_key_hex(&server_private).unwrap();
        let context = "lease-1:machine-1:activation-hash";
        let session = start_client_session(&server_public, 1_700_000_000_000, context).unwrap();
        let request_payload = SelectorProtocolRequestPayload {
            lease_token: "lease-token".to_string(),
            client_install_id: "install-1".to_string(),
            activation_code_hash: activation_code_hash("PF-ABC"),
            selector_version_known: Some(3),
            extension_version: Some("0.1.0".to_string()),
        };

        let request_bytes = encode_request(&request_payload, &session).unwrap();
        let decoded = decode_request(&request_bytes, &server_private, context).unwrap();
        assert_eq!(decoded.payload, request_payload);
        assert_eq!(decoded.client_nonce, session.client_nonce);

        let response_payload = SelectorProtocolResponsePayload {
            version: 4,
            encrypted_selector_blob: "encrypted".to_string(),
            checksum: "checksum".to_string(),
            min_app_version: "0.1.0".to_string(),
            expires_at: Some(1_700_000_100),
            server_time: 1_700_000_001,
        };
        let response = encode_response(&response_payload, &decoded.response_key()).unwrap();
        let decoded_response = decode_response(&response, &session.response_key()).unwrap();
        assert_eq!(decoded_response, response_payload);
    }

    #[test]
    fn tampered_request_fails() {
        let server_private = generate_server_private_key_hex();
        let server_public = server_public_key_hex(&server_private).unwrap();
        let context = "ctx";
        let session = start_client_session(&server_public, 1, context).unwrap();
        let payload = SelectorProtocolRequestPayload {
            lease_token: "lease-token".to_string(),
            client_install_id: "install".to_string(),
            activation_code_hash: activation_code_hash("PF-ABC"),
            selector_version_known: None,
            extension_version: None,
        };
        let mut request = encode_request(&payload, &session).unwrap();
        let last = request.len() - 1;
        request[last] ^= 0x01;
        assert_eq!(
            decode_request(&request, &server_private, context).unwrap_err(),
            SelectorProtocolError::DecryptFailed
        );
    }

    #[test]
    fn repeated_payload_uses_different_ciphertext() {
        let server_private = generate_server_private_key_hex();
        let server_public = server_public_key_hex(&server_private).unwrap();
        let payload = SelectorProtocolRequestPayload {
            lease_token: "lease-token".to_string(),
            client_install_id: "install".to_string(),
            activation_code_hash: activation_code_hash("PF-ABC"),
            selector_version_known: None,
            extension_version: None,
        };
        let s1 = start_client_session(&server_public, 1, "ctx").unwrap();
        let s2 = start_client_session(&server_public, 1, "ctx").unwrap();
        assert_ne!(
            encode_request(&payload, &s1).unwrap(),
            encode_request(&payload, &s2).unwrap()
        );
    }

    #[test]
    fn activation_protocol_roundtrip() {
        let server_private = generate_server_private_key_hex();
        let server_public = server_public_key_hex(&server_private).unwrap();
        let session = start_client_session(&server_public, 1_700_000_000_000, "pfap-v1").unwrap();
        let request_payload = ActivationProtocolRequestPayload {
            activation_code: "PF-ABC".to_string(),
            client_install_id: "install-1".to_string(),
            platform: "macos".to_string(),
            extension_version: Some("0.1.0".to_string()),
        };

        let request_bytes = encode_activation_request(&request_payload, &session).unwrap();
        let decoded =
            decode_activation_request(&request_bytes, &server_private, "pfap-v1").unwrap();
        assert_eq!(decoded.payload, request_payload);

        let response_payload = ActivationProtocolResponsePayload {
            lease_token: "lease-token".to_string(),
            lease_type: "subscription".to_string(),
            tier: "pro".to_string(),
            features: vec!["publish".to_string()],
            valid_from: 1_700_000_001,
            valid_until: 1_700_000_100,
            license_expires_at: Some(1_700_086_401),
            server_time: 1_700_000_001,
        };
        let response =
            encode_activation_response(&response_payload, &decoded.response_key()).unwrap();
        let decoded_response =
            decode_activation_response(&response, &session.response_key()).unwrap();
        assert_eq!(decoded_response, response_payload);
    }
}
