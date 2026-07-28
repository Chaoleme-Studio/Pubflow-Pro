//! PubFlow Remote Protocol (PFRP) v1, carried in binary WebSocket frames.

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use curve25519_dalek::montgomery::MontgomeryPoint;
use rand::RngCore;
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};

pub const MAGIC: &[u8; 4] = b"PFRP";
pub const VERSION: u8 = 1;
const AUTH_KIND: u8 = 1;
const MESSAGE_KIND: u8 = 2;
const AUTH_HEADER_LEN: usize = 4 + 1 + 1 + 8 + 12 + 32 + 4;
const MESSAGE_HEADER_LEN: usize = 4 + 1 + 1 + 8 + 12 + 4;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Copy)]
pub struct ClientSession {
    pub timestamp_ms: i64,
    pub client_nonce: [u8; NONCE_LEN],
    pub client_public_key: [u8; KEY_LEN],
    client_to_server_key: [u8; KEY_LEN],
    server_to_client_key: [u8; KEY_LEN],
}

impl ClientSession {
    pub fn client_to_server_key(&self) -> [u8; KEY_LEN] {
        self.client_to_server_key
    }
    pub fn server_to_client_key(&self) -> [u8; KEY_LEN] {
        self.server_to_client_key
    }
}

#[derive(Debug, Clone)]
pub struct DecodedAuth<T> {
    pub payload: T,
    pub timestamp_ms: i64,
    pub client_nonce: [u8; NONCE_LEN],
    pub keys: SessionKeys,
}

#[derive(Debug, Clone, Copy)]
pub struct SessionKeys {
    pub client_to_server: [u8; KEY_LEN],
    pub server_to_client: [u8; KEY_LEN],
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RemoteProtocolError {
    #[error("PFRP_BAD_MAGIC")]
    BadMagic,
    #[error("PFRP_UNSUPPORTED_VERSION")]
    UnsupportedVersion,
    #[error("PFRP_BAD_KIND")]
    BadKind,
    #[error("PFRP_BAD_LENGTH")]
    BadLength,
    #[error("PFRP_BAD_KEY")]
    BadKey,
    #[error("PFRP_DECRYPT_FAILED")]
    DecryptFailed,
    #[error("PFRP_ENCRYPT_FAILED")]
    EncryptFailed,
    #[error("PFRP_SERIALIZE_FAILED")]
    SerializeFailed,
    #[error("PFRP_SEQUENCE_MISMATCH")]
    SequenceMismatch,
}

pub fn start_client_session(
    server_public_key_hex: &str,
    timestamp_ms: i64,
) -> Result<ClientSession, RemoteProtocolError> {
    let server_public = key_from_hex(server_public_key_hex)?;
    let mut client_nonce = [0u8; NONCE_LEN];
    let mut client_private = [0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut client_nonce);
    rand::rngs::OsRng.fill_bytes(&mut client_private);
    let client_public_key = public_key_from_private(&client_private);
    let shared = ecdh(&client_private, &server_public)?;
    let keys = derive_keys(&shared, &server_public, &client_nonce, &client_public_key);
    Ok(ClientSession {
        timestamp_ms,
        client_nonce,
        client_public_key,
        client_to_server_key: keys.client_to_server,
        server_to_client_key: keys.server_to_client,
    })
}

pub fn encode_auth<T: Serialize>(
    payload: &T,
    session: &ClientSession,
) -> Result<Vec<u8>, RemoteProtocolError> {
    let plaintext =
        serde_json::to_vec(payload).map_err(|_| RemoteProtocolError::SerializeFailed)?;
    let mut header = Vec::with_capacity(AUTH_HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(VERSION);
    header.push(AUTH_KIND);
    header.extend_from_slice(&session.timestamp_ms.to_be_bytes());
    header.extend_from_slice(&session.client_nonce);
    header.extend_from_slice(&session.client_public_key);
    header.extend_from_slice(&0u32.to_be_bytes());
    let ciphertext = encrypt(
        &session.client_to_server_key,
        &session.client_nonce,
        &plaintext,
        &header,
    )?;
    write_len(&mut header, ciphertext.len())?;
    header.extend_from_slice(&ciphertext);
    Ok(header)
}

pub fn decode_auth<T: DeserializeOwned>(
    bytes: &[u8],
    server_private_key_hex: &str,
) -> Result<DecodedAuth<T>, RemoteProtocolError> {
    if bytes.len() < AUTH_HEADER_LEN {
        return Err(RemoteProtocolError::BadLength);
    }
    validate_prefix(bytes, AUTH_KIND)?;
    let timestamp_ms = i64::from_be_bytes(
        bytes[6..14]
            .try_into()
            .map_err(|_| RemoteProtocolError::BadLength)?,
    );
    let client_nonce = bytes[14..26]
        .try_into()
        .map_err(|_| RemoteProtocolError::BadLength)?;
    let client_public: [u8; KEY_LEN] = bytes[26..58]
        .try_into()
        .map_err(|_| RemoteProtocolError::BadLength)?;
    let declared = u32::from_be_bytes(
        bytes[58..62]
            .try_into()
            .map_err(|_| RemoteProtocolError::BadLength)?,
    ) as usize;
    if bytes.len() != AUTH_HEADER_LEN + declared {
        return Err(RemoteProtocolError::BadLength);
    }
    let server_private = key_from_hex(server_private_key_hex)?;
    let server_public = public_key_from_private(&server_private);
    let shared = ecdh(&server_private, &client_public)?;
    let keys = derive_keys(&shared, &server_public, &client_nonce, &client_public);
    let mut aad = bytes[..AUTH_HEADER_LEN].to_vec();
    aad[AUTH_HEADER_LEN - 4..].fill(0);
    let plaintext = decrypt(
        &keys.client_to_server,
        &client_nonce,
        &bytes[AUTH_HEADER_LEN..],
        &aad,
    )?;
    let payload =
        serde_json::from_slice(&plaintext).map_err(|_| RemoteProtocolError::DecryptFailed)?;
    Ok(DecodedAuth {
        payload,
        timestamp_ms,
        client_nonce,
        keys,
    })
}

pub fn encode_message<T: Serialize>(
    payload: &T,
    key: &[u8; KEY_LEN],
    sequence: u64,
) -> Result<Vec<u8>, RemoteProtocolError> {
    if sequence == 0 {
        return Err(RemoteProtocolError::SequenceMismatch);
    }
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut header = Vec::with_capacity(MESSAGE_HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(VERSION);
    header.push(MESSAGE_KIND);
    header.extend_from_slice(&sequence.to_be_bytes());
    header.extend_from_slice(&nonce);
    header.extend_from_slice(&0u32.to_be_bytes());
    let plaintext =
        serde_json::to_vec(payload).map_err(|_| RemoteProtocolError::SerializeFailed)?;
    let ciphertext = encrypt(key, &nonce, &plaintext, &header)?;
    write_len(&mut header, ciphertext.len())?;
    header.extend_from_slice(&ciphertext);
    Ok(header)
}

pub fn decode_message<T: DeserializeOwned>(
    bytes: &[u8],
    key: &[u8; KEY_LEN],
    expected_sequence: u64,
) -> Result<T, RemoteProtocolError> {
    if bytes.len() < MESSAGE_HEADER_LEN {
        return Err(RemoteProtocolError::BadLength);
    }
    validate_prefix(bytes, MESSAGE_KIND)?;
    let sequence = u64::from_be_bytes(
        bytes[6..14]
            .try_into()
            .map_err(|_| RemoteProtocolError::BadLength)?,
    );
    if sequence != expected_sequence || sequence == 0 {
        return Err(RemoteProtocolError::SequenceMismatch);
    }
    let nonce: [u8; NONCE_LEN] = bytes[14..26]
        .try_into()
        .map_err(|_| RemoteProtocolError::BadLength)?;
    let declared = u32::from_be_bytes(
        bytes[26..30]
            .try_into()
            .map_err(|_| RemoteProtocolError::BadLength)?,
    ) as usize;
    if bytes.len() != MESSAGE_HEADER_LEN + declared {
        return Err(RemoteProtocolError::BadLength);
    }
    let mut aad = bytes[..MESSAGE_HEADER_LEN].to_vec();
    aad[MESSAGE_HEADER_LEN - 4..].fill(0);
    let plaintext = decrypt(key, &nonce, &bytes[MESSAGE_HEADER_LEN..], &aad)?;
    serde_json::from_slice(&plaintext).map_err(|_| RemoteProtocolError::DecryptFailed)
}

pub fn key_from_hex(value: &str) -> Result<[u8; KEY_LEN], RemoteProtocolError> {
    hex::decode(value.trim())
        .map_err(|_| RemoteProtocolError::BadKey)?
        .try_into()
        .map_err(|_| RemoteProtocolError::BadKey)
}

fn validate_prefix(bytes: &[u8], kind: u8) -> Result<(), RemoteProtocolError> {
    if &bytes[..4] != MAGIC {
        return Err(RemoteProtocolError::BadMagic);
    }
    if bytes[4] != VERSION {
        return Err(RemoteProtocolError::UnsupportedVersion);
    }
    if bytes[5] != kind {
        return Err(RemoteProtocolError::BadKind);
    }
    Ok(())
}

fn write_len(header: &mut [u8], len: usize) -> Result<(), RemoteProtocolError> {
    if len > u32::MAX as usize || header.len() < 4 {
        return Err(RemoteProtocolError::BadLength);
    }
    let offset = header.len() - 4;
    header[offset..].copy_from_slice(&(len as u32).to_be_bytes());
    Ok(())
}

fn public_key_from_private(key: &[u8; KEY_LEN]) -> [u8; KEY_LEN] {
    MontgomeryPoint::mul_base_clamped(*key).0
}
fn ecdh(
    private: &[u8; KEY_LEN],
    public: &[u8; KEY_LEN],
) -> Result<[u8; KEY_LEN], RemoteProtocolError> {
    let shared = MontgomeryPoint(*public).mul_clamped(*private).0;
    if shared.iter().all(|b| *b == 0) {
        Err(RemoteProtocolError::BadKey)
    } else {
        Ok(shared)
    }
}
fn derive_keys(
    shared: &[u8; KEY_LEN],
    server_public: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    client_public: &[u8; KEY_LEN],
) -> SessionKeys {
    SessionKeys {
        client_to_server: derive_key(
            b"pubflow-pfrp-v1-client-server",
            shared,
            server_public,
            nonce,
            client_public,
        ),
        server_to_client: derive_key(
            b"pubflow-pfrp-v1-server-client",
            shared,
            server_public,
            nonce,
            client_public,
        ),
    }
}
fn derive_key(
    label: &[u8],
    shared: &[u8; KEY_LEN],
    server_public: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    client_public: &[u8; KEY_LEN],
) -> [u8; KEY_LEN] {
    let mut hash = Sha256::new();
    hash.update(label);
    hash.update(shared);
    hash.update(server_public);
    hash.update(nonce);
    hash.update(client_public);
    hash.finalize().into()
}
fn encrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, RemoteProtocolError> {
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| RemoteProtocolError::BadKey)?
        .encrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| RemoteProtocolError::EncryptFailed)
}
fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, RemoteProtocolError> {
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| RemoteProtocolError::BadKey)?
        .decrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| RemoteProtocolError::DecryptFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::selector_protocol::{generate_server_private_key_hex, server_public_key_hex};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Payload {
        value: String,
    }

    #[test]
    fn auth_and_directional_messages_roundtrip() {
        let private = generate_server_private_key_hex();
        let public = server_public_key_hex(&private).unwrap();
        let client = start_client_session(&public, 42).unwrap();
        let auth = encode_auth(
            &Payload {
                value: "auth".into(),
            },
            &client,
        )
        .unwrap();
        let decoded: DecodedAuth<Payload> = decode_auth(&auth, &private).unwrap();
        assert_eq!(decoded.payload.value, "auth");
        assert_eq!(decoded.keys.client_to_server, client.client_to_server_key());
        let frame = encode_message(
            &Payload {
                value: "job".into(),
            },
            &decoded.keys.server_to_client,
            1,
        )
        .unwrap();
        let payload: Payload = decode_message(&frame, &client.server_to_client_key(), 1).unwrap();
        assert_eq!(payload.value, "job");
        assert_eq!(
            decode_message::<Payload>(&frame, &client.server_to_client_key(), 2).unwrap_err(),
            RemoteProtocolError::SequenceMismatch
        );
    }
}
