use chrono::Utc;
use entity::{license, order};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::{new_activation_code, normalize_plan};
use crate::{AppState, ValidationError};

use super::dto::{
    AlipayNotifyRequest, CreateOrderRequest, CreateOrderResponse, OrderStatusResponse,
    PaymentCallbackRequest, PaymentCallbackResponse, WechatPayNotifyRequest,
};

pub struct PurchaseService {
    db: DatabaseConnection,
    query_secret: String,
}

impl FromState for PurchaseService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            query_secret: state.config.jwt_secret.clone(),
        }
    }
}

impl PurchaseService {
    pub async fn create_order(
        &self,
        req: CreateOrderRequest,
    ) -> Result<CreateOrderResponse, crate::AppError> {
        let plan = normalize_plan(&req.plan)?;
        let channel = normalize_channel(&req.channel)?;
        let amount_cents = plan_amount_cents(plan);
        let order_no = new_order_no();

        let inserted = order::ActiveModel {
            id: Set(Uuid::new_v4()),
            order_no: Set(order_no),
            plan: Set(plan.to_string()),
            amount_cents: Set(amount_cents),
            channel: Set(channel.to_string()),
            status: Set("pending".to_string()),
            machine_hash: Set(req.machine_hash),
            activation_code: Set(None),
            license_id: Set(None),
            paid_at: Set(None),
            created_at: Set(Utc::now().into()),
            updated_at: Set(Utc::now().into()),
        }
        .insert(&self.db)
        .await?;

        let query_token = generate_query_token(&inserted.order_no, &self.query_secret);

        Ok(CreateOrderResponse {
            order_no: inserted.order_no.clone(),
            plan: inserted.plan,
            amount_cents: inserted.amount_cents,
            channel: inserted.channel.clone(),
            status: inserted.status,
            pay_url: build_provider_pay_url(&inserted.channel, &inserted.order_no),
            query_token,
        })
    }

    pub async fn confirm_paid(
        &self,
        req: PaymentCallbackRequest,
        paid_amount_cents: Option<i32>,
    ) -> Result<PaymentCallbackResponse, crate::AppError> {
        if !req.paid {
            return Err(PubFlowError::InvalidOrderState.into());
        }

        let txn = self.db.begin().await?;

        // 先读取订单（用于金额校验）
        let order_model = order::Entity::find()
            .filter(order::Column::OrderNo.eq(&req.order_no))
            .one(&txn)
            .await?
            .ok_or(PubFlowError::OrderNotFound)?;

        // 金额校验在事务内完成，避免 TOCTOU 竞态
        if let Some(amount) = paid_amount_cents {
            if amount != order_model.amount_cents {
                // 原子更新：只有 pending 状态的订单才能被标记为 amount_mismatch
                let mismatch_result = order::Entity::update_many()
                    .filter(order::Column::OrderNo.eq(&req.order_no))
                    .filter(order::Column::Status.eq("pending"))
                    .set(order::ActiveModel {
                        status: Set("amount_mismatch".to_string()),
                        updated_at: Set(Utc::now().into()),
                        ..Default::default()
                    })
                    .exec(&txn)
                    .await?;
                txn.commit().await?;
                if mismatch_result.rows_affected == 0 {
                    // 订单已不在 pending 状态（可能已被并发确认），返回当前状态
                    return Err(PubFlowError::InvalidOrderState.into());
                }
                return Err(PubFlowError::InvalidOrderState.into());
            }
        }

        // 使用原子 UPDATE 防止并发重复确认：只有 pending 状态的订单才能被更新为 confirming
        let update_result = order::Entity::update_many()
            .filter(order::Column::OrderNo.eq(&req.order_no))
            .filter(order::Column::Status.eq("pending"))
            .set(order::ActiveModel {
                status: Set("confirming".to_string()),
                updated_at: Set(Utc::now().into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        if update_result.rows_affected == 0 {
            // 可能已 paid 或不存在
            let existing = order::Entity::find()
                .filter(order::Column::OrderNo.eq(&req.order_no))
                .one(&txn)
                .await?;
            txn.commit().await?;
            return match existing {
                Some(o) if o.status == "paid" => Ok(PaymentCallbackResponse {
                    order_no: o.order_no,
                    status: o.status,
                    activation_code: o.activation_code,
                    expires_at: None,
                }),
                Some(_) => Err(PubFlowError::InvalidOrderState.into()),
                None => Err(PubFlowError::OrderNotFound.into()),
            };
        }

        // 重新读取确认后的订单
        let confirmed_order = order::Entity::find()
            .filter(order::Column::OrderNo.eq(&req.order_no))
            .one(&txn)
            .await?
            .ok_or(PubFlowError::OrderNotFound)?;

        let now = Utc::now();
        let activation_code = new_activation_code();
        let license_id = Uuid::new_v4();

        license::ActiveModel {
            id: Set(license_id),
            user_id: Set(None),
            activation_code: Set(activation_code.clone()),
            tier: Set("pro".to_string()),
            plan: Set(confirmed_order.plan.clone()),
            source_channel: Set("official".to_string()),
            batch_id: Set(None),
            max_devices: Set(1),
            activated_at: Set(None),
            expires_at: Set(None),
            is_revoked: Set(false),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        let mut active_order: order::ActiveModel = confirmed_order.into();
        active_order.status = Set("paid".to_string());
        active_order.activation_code = Set(Some(activation_code.clone()));
        active_order.license_id = Set(Some(license_id));
        active_order.paid_at = Set(Some(now.into()));
        active_order.updated_at = Set(now.into());
        active_order.update(&txn).await?;

        txn.commit().await?;

        Ok(PaymentCallbackResponse {
            order_no: req.order_no,
            status: "paid".to_string(),
            activation_code: Some(activation_code),
            expires_at: None,
        })
    }

    pub async fn confirm_wechat_paid(
        &self,
        req: WechatPayNotifyRequest,
    ) -> Result<PaymentCallbackResponse, crate::AppError> {
        if req.trade_state != "SUCCESS" {
            tracing::warn!(
                order_no = %req.out_trade_no,
                trade_state = %req.trade_state,
                "微信支付回调状态非 SUCCESS"
            );
            return Ok(PaymentCallbackResponse {
                order_no: req.out_trade_no,
                status: "pending".to_string(),
                activation_code: None,
                expires_at: None,
            });
        }

        self.confirm_provider_paid(&req.out_trade_no, req.amount.map(|item| item.total))
            .await
    }

    pub async fn confirm_alipay_paid(
        &self,
        req: AlipayNotifyRequest,
    ) -> Result<PaymentCallbackResponse, crate::AppError> {
        if req.trade_status != "TRADE_SUCCESS" && req.trade_status != "TRADE_FINISHED" {
            return Ok(PaymentCallbackResponse {
                order_no: req.out_trade_no,
                status: "pending".to_string(),
                activation_code: None,
                expires_at: None,
            });
        }

        let amount_cents = parse_yuan_to_cents(&req.total_amount)?;
        self.confirm_provider_paid(&req.out_trade_no, Some(amount_cents))
            .await
    }

    async fn confirm_provider_paid(
        &self,
        order_no: &str,
        paid_amount_cents: Option<i32>,
    ) -> Result<PaymentCallbackResponse, crate::AppError> {
        // 金额校验和状态更新全部在 confirm_paid 事务内完成，避免 TOCTOU 竞态
        self.confirm_paid(
            PaymentCallbackRequest {
                order_no: order_no.to_string(),
                paid: true,
            },
            paid_amount_cents,
        )
        .await
    }

    pub async fn status(
        &self,
        order_no: String,
        query_token: &str,
    ) -> Result<OrderStatusResponse, crate::AppError> {
        // 验证 query_token，防止遍历订单号窃取激活码
        if !verify_query_token(&order_no, query_token, &self.query_secret) {
            return Err(PubFlowError::InvalidQueryToken.into());
        }

        let order_model = order::Entity::find()
            .filter(order::Column::OrderNo.eq(&order_no))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::OrderNotFound)?;

        Ok(OrderStatusResponse {
            order_no: order_model.order_no,
            status: order_model.status,
            activation_code: order_model.activation_code,
            license_id: order_model.license_id.map(|id| id.to_string()),
        })
    }
}

fn normalize_channel(channel: &str) -> Result<&'static str, ValidationError> {
    match channel {
        "wechat" => Ok("wechat"),
        "alipay" => Ok("alipay"),
        _ => Err(ValidationError::custom("channel 必须是 wechat 或 alipay")),
    }
}

fn plan_amount_cents(plan: &str) -> i32 {
    match plan {
        "monthly" => 1490,
        "yearly" => 9900,
        _ => unreachable!("plan should be validated by normalize_plan"),
    }
}

fn build_provider_pay_url(channel: &str, order_no: &str) -> String {
    match channel {
        "wechat" => format!("https://pay.weixin.qq.com/native/{order_no}"),
        "alipay" => format!(
            "https://openapi.alipay.com/gateway.do?out_trade_no={}",
            url::form_urlencoded::byte_serialize(order_no.as_bytes()).collect::<String>()
        ),
        _ => unreachable!("channel should be validated by normalize_channel"),
    }
}

fn parse_yuan_to_cents(value: &str) -> Result<i32, ValidationError> {
    let normalized = value.trim();
    let (yuan, cents) = normalized
        .split_once('.')
        .map_or((normalized, "0"), |(yuan, cents)| (yuan, cents));
    let yuan_value = yuan
        .parse::<i32>()
        .map_err(|_| ValidationError::custom("支付宝 total_amount 格式无效"))?;
    let cents_value = format!("{:0<2}", cents)
        .chars()
        .take(2)
        .collect::<String>()
        .parse::<i32>()
        .map_err(|_| ValidationError::custom("支付宝 total_amount 格式无效"))?;
    Ok(yuan_value * 100 + cents_value)
}

fn new_order_no() -> String {
    format!(
        "PF{}{}",
        Utc::now().timestamp_millis(),
        Uuid::new_v4().simple()
    )
}

fn generate_query_token(order_no: &str, secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(order_no.as_bytes());
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

fn verify_query_token(order_no: &str, token: &str, secret: &str) -> bool {
    let expected = generate_query_token(order_no, secret);
    // 常量时间比较，防止时序攻击
    expected.len() == token.len()
        && expected
            .as_bytes()
            .iter()
            .zip(token.as_bytes().iter())
            .fold(0, |acc, (a, b)| acc | (a ^ b))
            == 0
}
