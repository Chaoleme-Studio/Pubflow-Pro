use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

use crate::response::{ApiError, ApiResponse, Domain, ErrorDetail, Reason};

pub const DOMAIN: Domain = Domain("pubflow");

#[derive(Debug, Error)]
pub enum PubFlowError {
    #[error("激活码不存在或不可用")]
    LicenseNotFound,

    #[error("License 已过期")]
    LicenseExpired,

    #[error("License 已吊销")]
    LicenseRevoked,

    #[error("设备数量已达到上限")]
    DeviceLimitReached,

    #[error("设备未绑定")]
    DeviceNotBound,

    #[error("Lease 记录不存在")]
    LeaseNotFound,

    #[error("Selector 版本不存在")]
    SelectorNotFound,

    #[error("应用版本不存在")]
    AppVersionNotFound,

    #[error("下载文件不存在")]
    DownloadNotFound,

    #[error("订单不存在")]
    OrderNotFound,

    #[error("订单状态不允许当前操作")]
    InvalidOrderState,

    #[error("查询令牌无效或缺失")]
    InvalidQueryToken,

    #[error("请求签名或密钥配置无效")]
    InvalidCryptoConfig,

    #[error("请求过于频繁，请稍后重试")]
    RateLimitExceeded,

    #[error("今日远程发布额度已用完")]
    RemoteQuotaExceeded,

    #[error("远程发布任务不存在")]
    RemoteJobNotFound,

    #[error("远程发布素材不存在")]
    RemoteAssetNotFound,

    #[error("远程发布任务状态不允许当前操作")]
    InvalidRemoteJobState,

    #[error("发布插件未连接，请确认浏览器和插件已启动")]
    RemoteExtensionOffline,

    #[error("发布插件通道测试超时，请检查插件连接")]
    RemoteExtensionTimeout,

    #[error("当前授权不包含 Native 本地发布")]
    NativePublishNotIncluded,

    #[error("当前授权不包含云端远程发布")]
    RemotePublishNotIncluded,

    #[error("授权层级无效")]
    InvalidLicenseTier,

    #[error("插件版本过低，请更新后重试")]
    ExtensionUpgradeRequired,

    #[error("Selector 协议错误: {0}")]
    SelectorProtocol(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl IntoResponse for PubFlowError {
    fn into_response(self) -> Response {
        let api_error = match self {
            Self::LicenseNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::LicenseExpired => {
                ApiError::new(StatusCode::FORBIDDEN, self.to_string()).with_detail(
                    ErrorDetail::with_message(DOMAIN, Reason::PermissionDenied, "LICENSE_EXPIRED"),
                )
            }
            Self::LicenseRevoked => {
                ApiError::new(StatusCode::FORBIDDEN, self.to_string()).with_detail(
                    ErrorDetail::with_message(DOMAIN, Reason::PermissionDenied, "LICENSE_REVOKED"),
                )
            }
            Self::DeviceLimitReached => ApiError::new(StatusCode::CONFLICT, self.to_string())
                .with_detail(ErrorDetail::with_message(
                    DOMAIN,
                    Reason::DeviceLimitReached,
                    "DEVICE_LIMIT_REACHED",
                )),
            Self::DeviceNotBound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::LeaseNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::SelectorNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::AppVersionNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::DownloadNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::OrderNotFound => ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound)),
            Self::InvalidOrderState => ApiError::new(StatusCode::CONFLICT, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::Conflict)),
            Self::InvalidQueryToken => ApiError::new(StatusCode::FORBIDDEN, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::InvalidToken)),
            Self::InvalidCryptoConfig => {
                tracing::error!("invalid pubflow crypto configuration");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
            Self::RateLimitExceeded => {
                ApiError::new(StatusCode::TOO_MANY_REQUESTS, self.to_string()).with_detail(
                    ErrorDetail::with_message(
                        crate::response::Domain::RATE_LIMIT,
                        Reason::RateLimitExceeded,
                        "RATE_LIMIT_EXCEEDED",
                    ),
                )
            }
            Self::RemoteQuotaExceeded => {
                ApiError::new(StatusCode::TOO_MANY_REQUESTS, self.to_string()).with_detail(
                    ErrorDetail::with_message(
                        crate::response::Domain::RATE_LIMIT,
                        Reason::RateLimitExceeded,
                        "REMOTE_QUOTA_EXCEEDED",
                    ),
                )
            }
            Self::RemoteJobNotFound | Self::RemoteAssetNotFound => {
                ApiError::new(StatusCode::NOT_FOUND, self.to_string())
                    .with_detail(ErrorDetail::new(DOMAIN, Reason::NotFound))
            }
            Self::InvalidRemoteJobState => ApiError::new(StatusCode::CONFLICT, self.to_string())
                .with_detail(ErrorDetail::new(DOMAIN, Reason::Conflict)),
            Self::RemoteExtensionOffline => {
                ApiError::new(StatusCode::SERVICE_UNAVAILABLE, self.to_string()).with_detail(
                    ErrorDetail::with_message(
                        DOMAIN,
                        Reason::ServiceUnavailable,
                        "REMOTE_EXTENSION_OFFLINE",
                    ),
                )
            }
            Self::RemoteExtensionTimeout => {
                ApiError::new(StatusCode::GATEWAY_TIMEOUT, self.to_string()).with_detail(
                    ErrorDetail::with_message(
                        DOMAIN,
                        Reason::ServiceUnavailable,
                        "REMOTE_EXTENSION_TIMEOUT",
                    ),
                )
            }
            Self::NativePublishNotIncluded => capability_error(self, "NATIVE_PUBLISH_NOT_INCLUDED"),
            Self::RemotePublishNotIncluded => capability_error(self, "REMOTE_PUBLISH_NOT_INCLUDED"),
            Self::InvalidLicenseTier => capability_error(self, "INVALID_LICENSE_TIER"),
            Self::ExtensionUpgradeRequired => capability_error(self, "EXTENSION_UPGRADE_REQUIRED"),
            Self::SelectorProtocol(ref code) => {
                let status = match code.as_str() {
                    "PFSP_REPLAY" => StatusCode::CONFLICT,
                    "PFSP_LEASE_INVALID" | "PFSP_DEVICE_MISMATCH" => StatusCode::FORBIDDEN,
                    "PFSP_UNSUPPORTED_MEDIA_TYPE" => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "DEVICE_CHALLENGE_REQUIRED"
                    | "DEVICE_CHALLENGE_EXPIRED"
                    | "DEVICE_PUBLIC_KEY_REQUIRED"
                    | "DEVICE_PROOF_INVALID"
                    | "PERMIT_REQUEST_INVALID" => StatusCode::FORBIDDEN,
                    _ => StatusCode::BAD_REQUEST,
                };
                let public_message = selector_protocol_public_message(code);
                let public_code = selector_protocol_public_code(code);
                if public_code != code {
                    tracing::warn!(internal_code = %code, public_code, "pubflow selector protocol error redacted");
                }
                ApiError::new(status, public_message).with_detail(ErrorDetail::with_message(
                    DOMAIN,
                    Reason::InvalidFormat,
                    public_code,
                ))
            }
            Self::Internal(ref msg) => {
                tracing::error!(error = %msg, "pubflow internal error");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };

        ApiResponse::error(api_error).into_response()
    }
}

fn capability_error(error: PubFlowError, code: &'static str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, error.to_string()).with_detail(ErrorDetail::with_message(
        DOMAIN,
        Reason::PermissionDenied,
        code,
    ))
}

fn selector_protocol_public_code(code: &str) -> &str {
    match code {
        "DEVICE_CHALLENGE_REQUIRED"
        | "DEVICE_CHALLENGE_EXPIRED"
        | "DEVICE_PUBLIC_KEY_REQUIRED"
        | "DEVICE_PROOF_INVALID" => "DEVICE_AUTH_FAILED",
        "PERMIT_REQUEST_INVALID" => "PERMIT_REQUEST_INVALID",
        _ => code,
    }
}

fn selector_protocol_public_message(code: &str) -> &'static str {
    match code {
        "DEVICE_CHALLENGE_REQUIRED"
        | "DEVICE_CHALLENGE_EXPIRED"
        | "DEVICE_PUBLIC_KEY_REQUIRED"
        | "DEVICE_PROOF_INVALID" => "授权设备验证失败，请重新验证。",
        "PERMIT_REQUEST_INVALID" => "发布授权请求无效，请重新开始发布。",
        _ => "授权协议请求无效。",
    }
}
