use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use tower_governor::GovernorError;

/// 速率限制错误处理
///
/// 处理 tower_governor 的限流错误，返回适当的 HTTP 响应
pub async fn handle_rate_limit_error(err: GovernorError) -> Response {
    match err {
        GovernorError::TooManyRequests { headers, .. } => {
            let mut response = (
                StatusCode::TOO_MANY_REQUESTS,
                "请求过于频繁，请稍后重试".to_string(),
            )
                .into_response();

            // 添加速率限制相关的响应头
            if let Some(headers_map) = headers {
                let response_headers = response.headers_mut();
                for (name, value) in headers_map.iter() {
                    response_headers.insert(name.clone(), value.clone());
                }
            }

            response
        }
        GovernorError::UnableToExtractKey => {
            tracing::error!("无法提取速率限制的 key");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "服务器内部错误".to_string(),
            )
                .into_response()
        }
        GovernorError::Other { code, msg, headers } => {
            tracing::error!("速率限制其他错误: {:?}", msg);
            let mut response = (code, msg.unwrap_or_default()).into_response();

            if let Some(headers_map) = headers {
                let response_headers = response.headers_mut();
                for (name, value) in headers_map.iter() {
                    response_headers.insert(name.clone(), value.clone());
                }
            }

            response
        }
    }
}
