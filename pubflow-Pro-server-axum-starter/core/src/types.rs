//! 共享数据类型定义
//!
//! License 等级、设备状态、平台标识等枚举和结构体，
//! 被后端 API、WASM 模块、Native Helper 共同使用。

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

/// 订阅等级
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LicenseTier {
    Basic,
    Plus,
    Pro,
}

impl LicenseTier {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::Plus => "plus",
            Self::Pro => "pro",
        }
    }

    pub fn features(self) -> Vec<String> {
        let mut features = vec![
            "publish".to_string(),
            "batch".to_string(),
            "selector-updates".to_string(),
        ];
        if matches!(self, Self::Plus | Self::Pro) {
            features.push("native-publish".to_string());
        }
        if self == Self::Pro {
            features.push("remote-publish".to_string());
        }
        features
    }

    pub const fn allows_native_publish(self) -> bool {
        matches!(self, Self::Plus | Self::Pro)
    }

    pub const fn allows_remote_publish(self) -> bool {
        matches!(self, Self::Pro)
    }
}

impl fmt::Display for LicenseTier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for LicenseTier {
    type Err = InvalidLicenseTier;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "basic" => Ok(Self::Basic),
            "plus" => Ok(Self::Plus),
            "pro" => Ok(Self::Pro),
            _ => Err(InvalidLicenseTier(value.to_string())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidLicenseTier(pub String);

impl fmt::Display for InvalidLicenseTier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid license tier: {}", self.0)
    }
}

impl std::error::Error for InvalidLicenseTier {}

#[cfg(test)]
mod license_tier_tests {
    use super::*;

    #[test]
    fn exposes_only_three_product_tiers() {
        assert_eq!("basic".parse::<LicenseTier>().unwrap(), LicenseTier::Basic);
        assert_eq!("plus".parse::<LicenseTier>().unwrap(), LicenseTier::Plus);
        assert_eq!("pro".parse::<LicenseTier>().unwrap(), LicenseTier::Pro);
        assert!("enterprise".parse::<LicenseTier>().is_err());
        assert!("free".parse::<LicenseTier>().is_err());
    }

    #[test]
    fn capabilities_are_cumulative() {
        assert!(!LicenseTier::Basic.allows_native_publish());
        assert!(LicenseTier::Plus.allows_native_publish());
        assert!(!LicenseTier::Plus.allows_remote_publish());
        assert!(LicenseTier::Pro.allows_remote_publish());
    }
}

/// 设备状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceStatus {
    Active,
    Deactivated,
    Blocked,
}

/// 操作系统平台
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

/// API 统一响应格式
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}
