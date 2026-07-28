use std::str::FromStr;

use pubflow_core::types::LicenseTier;

use crate::{AppError, PubFlowError, ValidationError};

pub const FEATURE_PUBLISH: &str = "publish";
pub const FEATURE_NATIVE_PUBLISH: &str = "native-publish";
pub const FEATURE_REMOTE_PUBLISH: &str = "remote-publish";

pub fn parse_license_tier(value: &str) -> Result<LicenseTier, AppError> {
    LicenseTier::from_str(value).map_err(|_| PubFlowError::InvalidLicenseTier.into())
}

pub fn normalize_license_tier(value: &str) -> Result<&'static str, ValidationError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "basic" => Ok("basic"),
        "plus" => Ok("plus"),
        "pro" => Ok("pro"),
        _ => Err(ValidationError::custom("tier 必须是 basic、plus 或 pro")),
    }
}

pub fn features_for_tier(value: &str) -> Result<Vec<String>, AppError> {
    Ok(parse_license_tier(value)?.features())
}

pub fn require_native_publish(value: &str) -> Result<(), AppError> {
    if parse_license_tier(value)?.allows_native_publish() {
        Ok(())
    } else {
        Err(PubFlowError::NativePublishNotIncluded.into())
    }
}

pub fn require_remote_publish(value: &str) -> Result<(), AppError> {
    if parse_license_tier(value)?.allows_remote_publish() {
        Ok(())
    } else {
        Err(PubFlowError::RemotePublishNotIncluded.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_publish_is_available_only_to_plus_and_pro() {
        assert!(matches!(
            require_native_publish("basic"),
            Err(AppError::PubFlow(PubFlowError::NativePublishNotIncluded))
        ));
        assert!(require_native_publish("plus").is_ok());
        assert!(require_native_publish("pro").is_ok());
    }

    #[test]
    fn remote_publish_is_available_only_to_pro() {
        assert!(matches!(
            require_remote_publish("basic"),
            Err(AppError::PubFlow(PubFlowError::RemotePublishNotIncluded))
        ));
        assert!(matches!(
            require_remote_publish("plus"),
            Err(AppError::PubFlow(PubFlowError::RemotePublishNotIncluded))
        ));
        assert!(require_remote_publish("pro").is_ok());
    }
}
