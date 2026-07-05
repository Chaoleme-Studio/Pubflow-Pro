use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PaymentConfig {
    pub reseller_url: String,
    pub alipay: AlipayConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AlipayConfig {
    pub enabled: bool,
    pub app_id: String,
    pub gateway: String,
    pub notify_url: String,
    pub return_url: Option<String>,
    pub app_private_key_path: String,
    pub app_private_key: String,
    pub app_public_key_path: String,
    pub app_public_key: String,
    pub app_cert_path: String,
    pub app_cert_sn: String,
    pub alipay_root_cert_path: String,
    pub alipay_root_cert_sn: String,
    pub alipay_public_cert_path: String,
    pub alipay_public_key_path: String,
    pub alipay_public_key: String,
    pub subject_prefix: String,
    pub timeout_express: String,
}

impl Default for PaymentConfig {
    fn default() -> Self {
        Self {
            reseller_url: "https://www.aidoumi.com//links/6C406BEA".to_string(),
            alipay: AlipayConfig::default(),
        }
    }
}

impl Default for AlipayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            gateway: "https://openapi.alipay.com/gateway.do".to_string(),
            notify_url: String::new(),
            return_url: None,
            app_private_key_path: String::new(),
            app_private_key: String::new(),
            app_public_key_path: String::new(),
            app_public_key: String::new(),
            app_cert_path: String::new(),
            app_cert_sn: String::new(),
            alipay_root_cert_path: String::new(),
            alipay_root_cert_sn: String::new(),
            alipay_public_cert_path: String::new(),
            alipay_public_key_path: String::new(),
            alipay_public_key: String::new(),
            subject_prefix: "PubFlow Pro".to_string(),
            timeout_express: "30m".to_string(),
        }
    }
}

impl ConfigSection for PaymentConfig {
    fn section_name(&self) -> &str {
        "payment"
    }

    fn load_from_value(&mut self, value: &Value) -> Result<(), String> {
        if let Some(obj) = value.as_object() {
            if let Some(url) = obj.get("reseller_url").and_then(|v| v.as_str()) {
                self.reseller_url = url.to_string();
            }
            if let Some(alipay) = obj.get("alipay").and_then(|v| v.as_object()) {
                if let Some(enabled) = alipay.get("enabled").and_then(|v| v.as_bool()) {
                    self.alipay.enabled = enabled;
                }
                if let Some(app_id) = alipay.get("app_id").and_then(|v| v.as_str()) {
                    self.alipay.app_id = app_id.to_string();
                }
                if let Some(gateway) = alipay.get("gateway").and_then(|v| v.as_str()) {
                    self.alipay.gateway = gateway.to_string();
                }
                if let Some(notify_url) = alipay.get("notify_url").and_then(|v| v.as_str()) {
                    self.alipay.notify_url = notify_url.to_string();
                }
                if let Some(return_url) = alipay.get("return_url").and_then(|v| v.as_str()) {
                    self.alipay.return_url = Some(return_url.to_string());
                }
                if let Some(path) = alipay.get("app_private_key_path").and_then(|v| v.as_str()) {
                    self.alipay.app_private_key_path = path.to_string();
                }
                if let Some(key) = alipay.get("app_private_key").and_then(|v| v.as_str()) {
                    self.alipay.app_private_key = key.to_string();
                }
                if let Some(path) = alipay.get("app_public_key_path").and_then(|v| v.as_str()) {
                    self.alipay.app_public_key_path = path.to_string();
                }
                if let Some(key) = alipay.get("app_public_key").and_then(|v| v.as_str()) {
                    self.alipay.app_public_key = key.to_string();
                }
                if let Some(path) = alipay.get("app_cert_path").and_then(|v| v.as_str()) {
                    self.alipay.app_cert_path = path.to_string();
                }
                if let Some(sn) = alipay.get("app_cert_sn").and_then(|v| v.as_str()) {
                    self.alipay.app_cert_sn = sn.to_string();
                }
                if let Some(path) = alipay.get("alipay_root_cert_path").and_then(|v| v.as_str()) {
                    self.alipay.alipay_root_cert_path = path.to_string();
                }
                if let Some(sn) = alipay.get("alipay_root_cert_sn").and_then(|v| v.as_str()) {
                    self.alipay.alipay_root_cert_sn = sn.to_string();
                }
                if let Some(path) = alipay
                    .get("alipay_public_cert_path")
                    .and_then(|v| v.as_str())
                {
                    self.alipay.alipay_public_cert_path = path.to_string();
                }
                if let Some(path) = alipay
                    .get("alipay_public_key_path")
                    .and_then(|v| v.as_str())
                {
                    self.alipay.alipay_public_key_path = path.to_string();
                }
                if let Some(key) = alipay.get("alipay_public_key").and_then(|v| v.as_str()) {
                    self.alipay.alipay_public_key = key.to_string();
                }
                if let Some(prefix) = alipay.get("subject_prefix").and_then(|v| v.as_str()) {
                    self.alipay.subject_prefix = prefix.to_string();
                }
                if let Some(timeout) = alipay.get("timeout_express").and_then(|v| v.as_str()) {
                    self.alipay.timeout_express = timeout.to_string();
                }
            }
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if self.alipay.enabled {
            if self.alipay.app_id.trim().is_empty() {
                return Err("支付宝 APP_ID 未配置".to_string());
            }
            if self.alipay.notify_url.trim().is_empty() {
                return Err("支付宝异步通知地址 ALIPAY_NOTIFY_URL 未配置".to_string());
            }
            // 支付宝密钥支持在构建期嵌入二进制；这里不强制要求文件路径或明文配置。
            // 具体材料是否齐全在创建订单时由 SDK 初始化流程校验。
        }
        Ok(())
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        if let Ok(url) = env::var("PAYMENT_RESELLER_URL") {
            self.reseller_url = url;
        }
        if let Ok(enabled) = env::var("ALIPAY_ENABLED") {
            self.alipay.enabled = matches!(enabled.as_str(), "1" | "true" | "TRUE" | "yes" | "YES");
        }
        if let Ok(app_id) = env::var("ALIPAY_APP_ID") {
            self.alipay.app_id = app_id;
        }
        if let Ok(gateway) = env::var("ALIPAY_GATEWAY") {
            self.alipay.gateway = gateway;
        }
        if let Ok(notify_url) = env::var("ALIPAY_NOTIFY_URL") {
            self.alipay.notify_url = notify_url;
        }
        if let Ok(return_url) = env::var("ALIPAY_RETURN_URL") {
            self.alipay.return_url = Some(return_url);
        }
        if let Ok(path) = env::var("ALIPAY_APP_PRIVATE_KEY_PATH") {
            self.alipay.app_private_key_path = path;
        }
        if let Ok(key) = env::var("ALIPAY_APP_PRIVATE_KEY") {
            self.alipay.app_private_key = key;
        }
        if let Ok(path) = env::var("ALIPAY_APP_PUBLIC_KEY_PATH") {
            self.alipay.app_public_key_path = path;
        }
        if let Ok(key) = env::var("ALIPAY_APP_PUBLIC_KEY") {
            self.alipay.app_public_key = key;
        }
        if let Ok(path) = env::var("ALIPAY_APP_CERT_PATH") {
            self.alipay.app_cert_path = path;
        }
        if let Ok(sn) = env::var("ALIPAY_APP_CERT_SN") {
            self.alipay.app_cert_sn = sn;
        }
        if let Ok(path) = env::var("ALIPAY_ROOT_CERT_PATH") {
            self.alipay.alipay_root_cert_path = path;
        }
        if let Ok(sn) = env::var("ALIPAY_ROOT_CERT_SN") {
            self.alipay.alipay_root_cert_sn = sn;
        }
        if let Ok(path) = env::var("ALIPAY_PUBLIC_CERT_PATH") {
            self.alipay.alipay_public_cert_path = path;
        }
        if let Ok(path) = env::var("ALIPAY_PUBLIC_KEY_PATH") {
            self.alipay.alipay_public_key_path = path;
        }
        if let Ok(key) = env::var("ALIPAY_PUBLIC_KEY") {
            self.alipay.alipay_public_key = key;
        }
        if let Ok(prefix) = env::var("ALIPAY_SUBJECT_PREFIX") {
            self.alipay.subject_prefix = prefix;
        }
        if let Ok(timeout) = env::var("ALIPAY_TIMEOUT_EXPRESS") {
            self.alipay.timeout_express = timeout;
        }
        Ok(())
    }
}
