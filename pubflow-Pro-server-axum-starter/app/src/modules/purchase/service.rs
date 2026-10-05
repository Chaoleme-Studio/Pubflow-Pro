use chrono::Utc;
use entity::{license, order};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::product::service::ProductService;
use crate::shared::FromState;
use crate::shared::normalize_license_tier;
use crate::shared::plan::{device_migration_limit_for_plan, new_activation_code, normalize_plan};
use crate::{AppState, ValidationError};

use super::alipay::{AlipayClient, AlipayPrecreateInput};
use super::dto::{
    AlipayNotifyRequest, CreateOrderRequest, CreateOrderResponse, OrderStatusResponse,
    PaymentCallbackRequest, PaymentCallbackResponse, WechatPayNotifyRequest,
};
use std::collections::HashMap;

pub struct PurchaseService {
    db: DatabaseConnection,
    query_secret: String,
    alipay: AlipayClient,
    alipay_subject_prefix: String,
    reseller_url: String,
}

impl FromState for PurchaseService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            query_secret: state.config.jwt_secret.clone(),
            alipay_subject_prefix: state.config.payment.alipay.subject_prefix.clone(),
            alipay: AlipayClient::new(state.config.payment.alipay.clone()),
            reseller_url: state.config.payment.reseller_url.clone(),
        }
    }
}

impl PurchaseService {
    pub async fn create_order(
        &self,
        req: CreateOrderRequest,
    ) -> Result<CreateOrderResponse, crate::AppError> {
        let plan = normalize_plan(&req.plan)?;
        let tier = normalize_license_tier(&req.tier)?;
        let channel = normalize_channel(&req.channel)?;
        let amount_cents = ProductService::new(self.db.clone())
            .plan_amount_cents(plan, tier)
            .await?;
        let order_no = new_order_no();

        let inserted = order::ActiveModel {
            id: Set(Uuid::new_v4()),
            order_no: Set(order_no),
            tier: Set(tier.to_string()),
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

        let (pay_url, qr_code) = self
            .build_pay_payload(
                &inserted.channel,
                &inserted.order_no,
                &inserted.plan,
                inserted.amount_cents,
            )
            .await?;

        Ok(CreateOrderResponse {
            order_no: inserted.order_no.clone(),
            tier: inserted.tier.clone(),
            plan: inserted.plan,
            amount_cents: inserted.amount_cents,
            channel: inserted.channel.clone(),
            status: inserted.status,
            pay_url,
            qr_code,
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
        let device_migration_limit = device_migration_limit_for_plan(&confirmed_order.plan)?;

        license::ActiveModel {
            id: Set(license_id),
            user_id: Set(None),
            activation_code: Set(activation_code.clone()),
            tier: Set(confirmed_order.tier.clone()),
            plan: Set(confirmed_order.plan.clone()),
            source_channel: Set("official".to_string()),
            batch_id: Set(None),
            note: Set(None),
            max_devices: Set(1),
            remote_daily_job_limit: Set(None),
            remote_daily_byte_limit: Set(None),
            device_migration_limit: Set(device_migration_limit),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(None),
            expires_at: Set(None),
            is_revoked: Set(false),
            deleted_at: Set(None),
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

    pub async fn confirm_alipay_notify(
        &self,
        raw_body: &[u8],
    ) -> Result<PaymentCallbackResponse, crate::AppError> {
        if !self.alipay.verify_notify(raw_body)? {
            return Err(ValidationError::custom("支付宝通知验签失败").into());
        }

        let params: HashMap<String, String> =
            url::form_urlencoded::parse(raw_body).into_owned().collect();
        let out_trade_no = params
            .get("out_trade_no")
            .cloned()
            .ok_or_else(|| ValidationError::custom("支付宝通知缺少 out_trade_no"))?;
        let trade_status = params
            .get("trade_status")
            .cloned()
            .ok_or_else(|| ValidationError::custom("支付宝通知缺少 trade_status"))?;
        if trade_status != "TRADE_SUCCESS" && trade_status != "TRADE_FINISHED" {
            return Ok(PaymentCallbackResponse {
                order_no: out_trade_no,
                status: "pending".to_string(),
                activation_code: None,
                expires_at: None,
            });
        }
        let total_amount = params
            .get("total_amount")
            .ok_or_else(|| ValidationError::custom("支付宝通知缺少 total_amount"))?;
        let amount_cents = parse_yuan_to_cents(total_amount)?;

        self.confirm_provider_paid(&out_trade_no, Some(amount_cents))
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

    async fn build_pay_payload(
        &self,
        channel: &str,
        order_no: &str,
        plan: &str,
        amount_cents: i32,
    ) -> Result<(String, Option<String>), crate::AppError> {
        match channel {
            "alipay" if self.alipay.is_enabled() => {
                let output = self
                    .alipay
                    .precreate(AlipayPrecreateInput {
                        out_trade_no: order_no.to_string(),
                        subject: format!("{} {}", self.alipay_subject_prefix, plan_label(plan)),
                        total_amount: cents_to_yuan(amount_cents),
                    })
                    .await?;
                Ok((output.qr_code.clone(), Some(output.qr_code)))
            }
            "alipay" => Ok((self.reseller_url.clone(), None)),
            "wechat" => Ok((format!("https://pay.weixin.qq.com/native/{order_no}"), None)),
            _ => unreachable!("channel should be validated by normalize_channel"),
        }
    }
}

fn normalize_channel(channel: &str) -> Result<&'static str, ValidationError> {
    match channel {
        "wechat" => Ok("wechat"),
        "alipay" => Ok("alipay"),
        _ => Err(ValidationError::custom("channel 必须是 wechat 或 alipay")),
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

fn cents_to_yuan(amount_cents: i32) -> String {
    format!("{}.{:02}", amount_cents / 100, amount_cents.abs() % 100)
}

fn plan_label(plan: &str) -> &'static str {
    match plan {
        "monthly" => "月卡",
        "yearly" => "年卡",
        _ => "授权",
    }
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
