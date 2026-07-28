use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::Arc,
};

use p256::SecretKey;
use serde_json::Value;
use tokio::sync::{Mutex, RwLock, broadcast};

use crate::{config::Settings, database::JobDatabase};

pub struct LocalChallenge {
    pub secret_key: SecretKey,
    pub expires_at_ms: i64,
}

#[derive(Clone)]
pub struct LocalSession {
    pub tier: String,
    pub features: Vec<String>,
    pub license_expires_at: Option<String>,
    pub access_expires_at: String,
    pub expires_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ExtensionGrant {
    pub tier: String,
    pub features: Vec<String>,
    pub valid_until: i64,
}

#[derive(Default)]
pub struct LocalLoginAttempt {
    pub failed_at_ms: VecDeque<i64>,
    pub locked_until_ms: i64,
}

pub struct AppState {
    pub settings: Settings,
    pub database: JobDatabase,
    pub events: broadcast::Sender<Value>,
    pub create_lock: Mutex<()>,
    pub extension_workspace_match: RwLock<Option<bool>>,
    pub extension_version: RwLock<Option<String>>,
    pub extension_grant: RwLock<Option<ExtensionGrant>>,
    pub local_challenges: Mutex<HashMap<String, LocalChallenge>>,
    pub local_sessions: Mutex<HashMap<String, LocalSession>>,
    pub local_login_attempts: Mutex<HashMap<IpAddr, LocalLoginAttempt>>,
}

impl AppState {
    pub fn new(settings: Settings, database: JobDatabase) -> Arc<Self> {
        let (events, _) = broadcast::channel(128);
        Arc::new(Self {
            settings,
            database,
            events,
            create_lock: Mutex::new(()),
            extension_workspace_match: RwLock::new(None),
            extension_version: RwLock::new(None),
            extension_grant: RwLock::new(None),
            local_challenges: Mutex::new(HashMap::new()),
            local_sessions: Mutex::new(HashMap::new()),
            local_login_attempts: Mutex::new(HashMap::new()),
        })
    }
}
