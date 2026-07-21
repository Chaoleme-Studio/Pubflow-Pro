use std::fs;

use alipay_sdk_rust::biz::{self, BizContenter};
use alipay_sdk_rust::pay::{PayClient, Payer};

use crate::core::config::AlipayConfig;
use crate::{PubFlowError, ValidationError};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/alipay_embedded.rs"));
}

#[derive(Debug, Clone)]
pub struct AlipayPrecreateInput {
    pub out_trade_no: String,
    pub subject: String,
    pub total_amount: String,
}

#[derive(Debug, Clone)]
pub struct AlipayPrecreateOutput {
    pub qr_code: String,
}

#[derive(Clone)]
pub struct AlipayClient {
    config: AlipayConfig,
}

impl AlipayClient {
    pub fn new(config: AlipayConfig) -> Self {
        Self { config }
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    pub async fn precreate(
        &self,
        input: AlipayPrecreateInput,
    ) -> Result<AlipayPrecreateOutput, crate::AppError> {
        if !self.config.enabled {
            return Err(ValidationError::custom("支付宝支付未启用").into());
        }

        let config = self.config.clone();
        tokio::task::spawn_blocking(move || precreate_with_sdk(config, input))
            .await
            .map_err(|error| PubFlowError::Internal(format!("支付宝预下单任务失败: {error}")))?
    }

    pub fn verify_notify(&self, raw_body: &[u8]) -> Result<bool, crate::AppError> {
        if !self.config.enabled {
            return Ok(false);
        }
        let material = AlipayMaterial::from_config(&self.config)?;
        let client = build_pay_client(&self.config, &material)?;
        client
            .async_verify_sign(raw_body)
            .map_err(|error| PubFlowError::Internal(format!("支付宝通知验签失败: {error}")).into())
    }
}

fn precreate_with_sdk(
    config: AlipayConfig,
    input: AlipayPrecreateInput,
) -> Result<AlipayPrecreateOutput, crate::AppError> {
    let material = AlipayMaterial::from_config(&config)?;
    let client = build_pay_client(&config, &material)?;

    let mut biz_content = biz::TradePrecreateBiz::new();
    biz_content.set_out_trade_no(input.out_trade_no.into());
    biz_content.set_total_amount(input.total_amount.into());
    biz_content.set_subject(input.subject.into());
    if !config.timeout_express.trim().is_empty() {
        biz_content.set("timeout_express", config.timeout_express.clone().into());
    }

    let response = client
        .trade_precreate(&biz_content)
        .map_err(|error| PubFlowError::Internal(format!("支付宝预下单失败: {error}")))?;
    let qr_code = response
        .response
        .qr_code
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ValidationError::custom("支付宝预下单未返回二维码"))?;

    Ok(AlipayPrecreateOutput { qr_code })
}

fn build_pay_client(
    config: &AlipayConfig,
    material: &AlipayMaterial,
) -> Result<impl Payer, crate::AppError> {
    let mut builder = PayClient::builder();
    builder
        .api_url(config.gateway.trim())
        .app_id(config.app_id.trim())
        // Empty certificate fields select the ordinary RSA public-key mode.
        .alipay_root_cert_sn("")
        .alipay_public_key(&material.alipay_public_key)
        .app_cert_sn("")
        .charset_utf8()
        .format_json()
        .private_key(&material.app_private_key)
        // alipay_sdk_rust requires this builder slot even in public-key mode;
        // verification uses alipay_public_key above.
        .public_key(&material.alipay_public_key)
        .sign_type_rsa2()
        .version_1_0()
        .notify_url(config.notify_url.trim());

    if let Some(return_url) = config
        .return_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder.return_url(return_url);
    }

    builder
        .build()
        .map_err(|error| PubFlowError::Internal(format!("支付宝 SDK 初始化失败: {error}")).into())
}

struct AlipayMaterial {
    app_private_key: String,
    alipay_public_key: String,
}

impl AlipayMaterial {
    fn from_config(config: &AlipayConfig) -> Result<Self, crate::AppError> {
        Ok(Self {
            app_private_key: read_key_material(
                &config.app_private_key,
                &config.app_private_key_file,
                "支付宝应用私钥",
                EmbeddedKey::AppPrivate,
            )?,
            alipay_public_key: read_or_derive_alipay_public_key(config)?,
        })
    }
}

fn read_or_derive_alipay_public_key(config: &AlipayConfig) -> Result<String, crate::AppError> {
    if !config.alipay_public_key.trim().is_empty()
        || !config.alipay_public_key_file.trim().is_empty()
    {
        return read_key_material(
            &config.alipay_public_key,
            &config.alipay_public_key_file,
            "支付宝公钥",
            EmbeddedKey::AlipayPublic,
        );
    }
    if let Some(value) = embedded_key(EmbeddedKey::AlipayPublic) {
        return Ok(strip_pem_noise(value));
    }
    Err(ValidationError::custom(
        "支付宝公钥未配置：请填写 alipay_public_key 或 alipay_public_key_file",
    )
    .into())
}

#[derive(Clone, Copy)]
enum EmbeddedKey {
    AppPrivate,
    AlipayPublic,
}

fn read_key_material(
    inline: &str,
    path: &str,
    label: &str,
    embedded: EmbeddedKey,
) -> Result<String, crate::AppError> {
    let inline = inline.trim();
    if !inline.is_empty() {
        return Ok(strip_pem_noise(inline));
    }
    let path = path.trim();
    if !path.is_empty() {
        return fs::read_to_string(path)
            .map(|value| strip_pem_noise(&value))
            .map_err(|error| {
                PubFlowError::Internal(format!("{label}文件读取失败（{path}）: {error}")).into()
            });
    }
    if let Some(value) = embedded_key(embedded) {
        return Ok(strip_pem_noise(value));
    }
    Err(ValidationError::custom(format!("{label}未配置")).into())
}

fn embedded_key(kind: EmbeddedKey) -> Option<&'static str> {
    match kind {
        EmbeddedKey::AppPrivate => embedded::APP_PRIVATE_KEY,
        EmbeddedKey::AlipayPublic => embedded::ALIPAY_PUBLIC_KEY,
    }
}

fn strip_pem_noise(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("-----BEGIN "))
        .filter(|line| !line.starts_with("-----END "))
        .collect::<String>()
}
