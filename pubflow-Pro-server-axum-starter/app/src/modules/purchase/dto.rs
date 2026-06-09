use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateOrderRequest {
    pub plan: String,
    pub channel: String,
    pub machine_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateOrderResponse {
    pub order_no: String,
    pub plan: String,
    pub amount_cents: i32,
    pub channel: String,
    pub status: String,
    pub pay_url: String,
    /// 查询令牌，用于安全查询订单状态（防止遍历订单号窃取激活码）
    pub query_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PaymentCallbackRequest {
    pub order_no: String,
    pub paid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WechatPayNotifyRequest {
    pub out_trade_no: String,
    pub transaction_id: Option<String>,
    pub trade_state: String,
    pub amount: Option<WechatPayAmount>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WechatPayAmount {
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AlipayNotifyRequest {
    pub out_trade_no: String,
    pub trade_no: Option<String>,
    pub trade_status: String,
    pub total_amount: String,
    pub sign: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PaymentCallbackResponse {
    pub order_no: String,
    pub status: String,
    pub activation_code: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OrderStatusResponse {
    pub order_no: String,
    pub status: String,
    pub activation_code: Option<String>,
    pub license_id: Option<String>,
}
