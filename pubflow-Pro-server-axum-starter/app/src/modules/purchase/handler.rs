use aide::transform::TransformOperation;
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    CreateOrderRequest, CreateOrderResponse, OrderStatusResponse, PaymentCallbackRequest,
    PaymentCallbackResponse, WechatPayNotifyRequest,
};
use super::service::PurchaseService;

pub async fn create_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateOrderRequest>,
) -> Result<ApiResponse<CreateOrderResponse>, AppError> {
    let service = PurchaseService::from_state(&state);
    Ok(ApiResponse::success(service.create_order(req).await?))
}

pub fn create_order_docs(op: TransformOperation) -> TransformOperation {
    op.description("创建购买订单")
        .tag("PubFlow Purchase")
        .response::<200, ApiResponse<CreateOrderResponse>>()
}

pub async fn confirm_paid(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PaymentCallbackRequest>,
) -> Result<ApiResponse<PaymentCallbackResponse>, AppError> {
    let service = PurchaseService::from_state(&state);
    Ok(ApiResponse::success(service.confirm_paid(req, None).await?))
}

pub fn confirm_paid_docs(op: TransformOperation) -> TransformOperation {
    op.description("支付成功回调并开通 License")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<PaymentCallbackResponse>>()
}

pub async fn wechat_notify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WechatPayNotifyRequest>,
) -> Result<ApiResponse<PaymentCallbackResponse>, AppError> {
    let service = PurchaseService::from_state(&state);
    Ok(ApiResponse::success(
        service.confirm_wechat_paid(req).await?,
    ))
}

pub fn wechat_notify_docs(op: TransformOperation) -> TransformOperation {
    op.description("微信支付异步通知，成功后自动开通 License")
        .tag("PubFlow Purchase")
        .response::<200, ApiResponse<PaymentCallbackResponse>>()
}

pub async fn alipay_notify(State(state): State<Arc<AppState>>, body: Bytes) -> &'static str {
    let service = PurchaseService::from_state(&state);
    match service.confirm_alipay_notify(&body).await {
        Ok(_) => "success",
        Err(error) => {
            tracing::warn!(error = %error, "alipay notify failed");
            "failure"
        }
    }
}

pub fn alipay_notify_docs(op: TransformOperation) -> TransformOperation {
    op.description("支付宝异步通知，成功后自动开通 License")
        .tag("PubFlow Purchase")
        .response::<200, String>()
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    Path(order_no): Path<String>,
    RawQuery(raw): RawQuery,
) -> Result<ApiResponse<OrderStatusResponse>, AppError> {
    let service = PurchaseService::from_state(&state);
    let token = raw
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v.into_owned())
        })
        .unwrap_or_default();
    Ok(ApiResponse::success(
        service.status(order_no, &token).await?,
    ))
}

pub fn status_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询购买订单状态（需要 query token 验证）")
        .tag("PubFlow Purchase")
        .response::<200, ApiResponse<OrderStatusResponse>>()
}
