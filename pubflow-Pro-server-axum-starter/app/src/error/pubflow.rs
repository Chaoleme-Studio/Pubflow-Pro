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

    #[error("订单不存在")]
    OrderNotFound,

    #[error("订单状态不允许当前操作")]
    InvalidOrderState,

    #[error("查询令牌无效或缺失")]
    InvalidQueryToken,

    #[error("请求签名或密钥配置无效")]
    InvalidCryptoConfig,

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
            Self::SelectorProtocol(ref code) => {
                let status = match code.as_str() {
                    "PFSP_REPLAY" => StatusCode::CONFLICT,
                    "PFSP_LEASE_INVALID" | "PFSP_DEVICE_MISMATCH" => StatusCode::FORBIDDEN,
                    "PFSP_UNSUPPORTED_MEDIA_TYPE" => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    _ => StatusCode::BAD_REQUEST,
                };
                ApiError::new(status, self.to_string()).with_detail(ErrorDetail::with_message(
                    DOMAIN,
                    Reason::InvalidFormat,
                    code,
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
