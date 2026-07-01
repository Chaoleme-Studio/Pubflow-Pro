use chrono::{Duration, Utc};
use entity::{lease, license, order, product_catalog, user};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Set,
};
use uuid::Uuid;

use crate::shared::password::hash_password;
use crate::{AppError, error::AuthError};

struct DemoAccount {
    username: &'static str,
    email: &'static str,
    plan: &'static str,
    channel: &'static str,
    machine_hash: &'static str,
    platform: &'static str,
    amount_cents: i32,
    paid_days_ago: i64,
}

const DEMO_ACCOUNTS: &[DemoAccount] = &[
    DemoAccount {
        username: "NorthLab Media",
        email: "creator@northlab.cn",
        plan: "yearly",
        channel: "wechat",
        machine_hash: "9ff0b2c4e8a65d20a91c73411df3caae",
        platform: "macos",
        amount_cents: 9900,
        paid_days_ago: 0,
    },
    DemoAccount {
        username: "Aurora Studio",
        email: "ops@aurora.video",
        plan: "yearly",
        channel: "alipay",
        machine_hash: "d3ad7719b02f44a1f028ed11940ec517",
        platform: "windows",
        amount_cents: 9900,
        paid_days_ago: 4,
    },
    DemoAccount {
        username: "BlueHour AI",
        email: "growth@bluehour.ai",
        plan: "monthly",
        channel: "wechat",
        machine_hash: "4c02a8d911ff802e6c2bb0f9f91af182",
        platform: "macos",
        amount_cents: 1490,
        paid_days_ago: 12,
    },
    DemoAccount {
        username: "PixelBay",
        email: "shorts@pixelbay.cn",
        plan: "monthly",
        channel: "manual",
        machine_hash: "a0c9931fe74102bf120ef19cd8f71aa5",
        platform: "linux",
        amount_cents: 1490,
        paid_days_ago: 22,
    },
];

pub async fn seed_demo_data_if_enabled(db: &DatabaseConnection) -> Result<(), AppError> {
    seed_product_catalog(db).await?;

    if std::env::var("APP_SEED_DEMO").as_deref() != Ok("true") {
        return Ok(());
    }

    for account in DEMO_ACCOUNTS {
        seed_account(db, account).await?;
    }

    tracing::info!("Demo seed data is ready");
    Ok(())
}

struct CatalogSeed {
    kind: &'static str,
    code: &'static str,
    name: &'static str,
    price: Option<&'static str>,
    unit: Option<&'static str>,
    note: Option<&'static str>,
    amount_cents: Option<i32>,
    platform: Option<&'static str>,
    chip: Option<&'static str>,
    file_name: Option<&'static str>,
    href: Option<&'static str>,
    sort_order: i32,
}

const CATALOG_SEEDS: &[CatalogSeed] = &[
    CatalogSeed {
        kind: "plan",
        code: "monthly",
        name: "月卡",
        price: Some("14.9"),
        unit: Some("元/月"),
        note: Some("适合短期活动、临时矩阵号发布"),
        amount_cents: Some(1490),
        platform: None,
        chip: None,
        file_name: None,
        href: None,
        sort_order: 10,
    },
    CatalogSeed {
        kind: "plan",
        code: "yearly",
        name: "年卡",
        price: Some("99"),
        unit: Some("元/年"),
        note: Some("长期创作者和团队最划算"),
        amount_cents: Some(9900),
        platform: None,
        chip: None,
        file_name: None,
        href: None,
        sort_order: 20,
    },
    CatalogSeed {
        kind: "download",
        code: "zip",
        name: "离线包 (ZIP)",
        price: None,
        unit: None,
        note: Some("解压后通过开发者模式加载，推荐使用。"),
        amount_cents: None,
        platform: Some("extension"),
        chip: Some("Chrome / Edge / Chromium"),
        file_name: Some("pubflow-extension.zip"),
        href: Some("/v1/downloads/pubflow-extension.zip"),
        sort_order: 100,
    },
    CatalogSeed {
        kind: "download",
        code: "crx",
        name: "Chrome 扩展 (CRX)",
        price: None,
        unit: None,
        note: Some("部分浏览器可能限制 CRX 安装，无法安装时请使用 ZIP。"),
        amount_cents: None,
        platform: Some("extension"),
        chip: Some("Chrome / Edge / Chromium"),
        file_name: Some("pubflow-extension.crx"),
        href: Some("/v1/downloads/pubflow-extension.crx"),
        sort_order: 110,
    },
];

async fn seed_product_catalog(db: &DatabaseConnection) -> Result<(), AppError> {
    for item in CATALOG_SEEDS {
        let existing = product_catalog::Entity::find()
            .filter(product_catalog::Column::Kind.eq(item.kind))
            .filter(product_catalog::Column::Code.eq(item.code))
            .one(db)
            .await?;
        if item.kind == "plan" && existing.is_some() {
            continue;
        }
        let now = Utc::now();
        let is_new = existing.is_none();
        let mut active = if let Some(existing) = existing {
            existing.into()
        } else {
            product_catalog::ActiveModel {
                id: Set(Uuid::new_v4()),
                kind: Set(item.kind.to_string()),
                code: Set(item.code.to_string()),
                created_at: Set(now.into()),
                ..Default::default()
            }
        };
        active.name = Set(item.name.to_string());
        active.price = Set(item.price.map(ToOwned::to_owned));
        active.unit = Set(item.unit.map(ToOwned::to_owned));
        active.note = Set(item.note.map(ToOwned::to_owned));
        active.amount_cents = Set(item.amount_cents);
        active.original_amount_cents = Set(item.amount_cents);
        active.platform = Set(item.platform.map(ToOwned::to_owned));
        active.chip = Set(item.chip.map(ToOwned::to_owned));
        active.file_name = Set(item.file_name.map(ToOwned::to_owned));
        active.href = Set(item.href.map(ToOwned::to_owned));
        active.sort_order = Set(item.sort_order);
        active.is_active = Set(true);
        active.updated_at = Set(now.into());
        if is_new {
            active.insert(db).await?;
        } else {
            active.update(db).await?;
        }
    }

    product_catalog::Entity::update_many()
        .filter(product_catalog::Column::Kind.eq("download"))
        .filter(product_catalog::Column::Code.is_not_in(["zip", "crx"]))
        .set(product_catalog::ActiveModel {
            is_active: Set(false),
            updated_at: Set(Utc::now().into()),
            ..Default::default()
        })
        .exec(db)
        .await?;

    Ok(())
}

async fn seed_account(db: &DatabaseConnection, account: &DemoAccount) -> Result<(), AppError> {
    // 检查用户是否已存在
    let existing_user = user::Entity::find()
        .filter(user::Column::Email.eq(account.email))
        .one(db)
        .await?;

    if let Some(user_model) = existing_user {
        // 用户已存在，检查是否需要补充 lease 数据
        seed_lease_if_missing(db, user_model.id).await?;
        return Ok(());
    }

    let now = Utc::now();
    let paid_at = now - Duration::days(account.paid_days_ago);
    let expires_at = if account.plan == "yearly" {
        paid_at + Duration::days(365)
    } else {
        paid_at + Duration::days(31)
    };
    let user_model = user::ActiveModel {
        username: Set(account.username.to_string()),
        email: Set(account.email.to_string()),
        password_hash: Set(hash_password("pubflow-demo-password")
            .map_err(|error| AuthError::Internal(error.to_string()))?),
        status: Set(0),
        created_at: Set(paid_at.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    }
    .insert(db)
    .await?;

    let license_id = Uuid::new_v4();
    let activation_code = demo_activation_code(account.email);
    license::ActiveModel {
        id: Set(license_id),
        user_id: Set(Some(user_model.id)),
        activation_code: Set(activation_code.clone()),
        tier: Set("pro".to_string()),
        plan: Set(account.plan.to_string()),
        source_channel: Set("official".to_string()),
        batch_id: Set(None),
        max_devices: Set(1),
        device_migration_limit: Set(3),
        device_migration_count: Set(0),
        last_migrated_at: Set(None),
        activated_at: Set(Some(paid_at.into())),
        expires_at: Set(Some(expires_at.into())),
        is_revoked: Set(false),
        created_at: Set(paid_at.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;

    order::ActiveModel {
        id: Set(Uuid::new_v4()),
        order_no: Set(format!("PF-DEMO-{}", user_model.id)),
        plan: Set(account.plan.to_string()),
        amount_cents: Set(account.amount_cents),
        channel: Set(account.channel.to_string()),
        status: Set("paid".to_string()),
        machine_hash: Set(Some(account.machine_hash.to_string())),
        activation_code: Set(Some(activation_code)),
        license_id: Set(Some(license_id)),
        paid_at: Set(Some(paid_at.into())),
        created_at: Set(paid_at.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;

    // 生成 lease 记录（模拟用户激活和多次验证）
    let valid_until = now + Duration::days(30);
    let lease_ips = ["112.45.67.89", "223.71.156.42", "183.15.200.101"];
    for i in 0..3u8 {
        let created = now - Duration::hours((i as i64) * 8);
        lease::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(license_id),
            lease_type: Set("subscription".to_string()),
            tier: Set("pro".to_string()),
            features: Set(r#"["publish","batch","selector-updates"]"#.to_string()),
            lease_token: Set(format!("demo-jwt-{}-{}", account.machine_hash, i)),
            valid_from: Set(paid_at.into()),
            valid_until: Set(valid_until.into()),
            min_extension_version: Set("0.1.0".to_string()),
            policy_version: Set(1),
            is_revoked: Set(false),
            ip_address: Set(lease_ips[i as usize].to_string()),
            machine_hash: Set(account.machine_hash.to_string()),
            client_install_id: Set(Some(account.machine_hash.to_string())),
            platform: Set(account.platform.to_string()),
            created_at: Set(created.into()),
            updated_at: Set(created.into()),
        }
        .insert(db)
        .await?;
    }

    Ok(())
}

fn demo_activation_code(email: &str) -> String {
    let digest = pubflow_core::machine::generate_machine_hash(email, "pubflow-demo-seed");
    format!("PF-{}", &digest[..16].to_uppercase())
}

/// 为已有用户补充 lease 种子数据（如果缺失）
async fn seed_lease_if_missing(db: &DatabaseConnection, user_id: i32) -> Result<(), AppError> {
    // 查找该用户的 license
    let lic = license::Entity::find()
        .filter(license::Column::UserId.eq(Some(user_id)))
        .one(db)
        .await?;
    let Some(lic) = lic else { return Ok(()) };

    // 检查是否已有 lease 记录
    let existing = lease::Entity::find()
        .filter(lease::Column::LicenseId.eq(lic.id))
        .count(db)
        .await?;
    if existing > 0 {
        return Ok(());
    }

    // 从订单获取 machine_hash
    let ord = order::Entity::find()
        .filter(order::Column::LicenseId.eq(Some(lic.id)))
        .one(db)
        .await?;
    let machine_hash = ord
        .and_then(|o| o.machine_hash)
        .unwrap_or_else(|| "unknown".to_string());

    let now = Utc::now();
    let valid_until = now + Duration::days(30);
    let ips = ["112.45.67.89", "223.71.156.42", "183.15.200.101"];

    for i in 0..3u8 {
        let created = now - Duration::hours((i as i64) * 8);
        let lease_token = format!("demo-jwt-{}-{}-{}", lic.id, machine_hash, i);
        let existing_token = lease::Entity::find()
            .filter(lease::Column::LeaseToken.eq(&lease_token))
            .one(db)
            .await?;
        if existing_token.is_some() {
            continue;
        }
        lease::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(lic.id),
            lease_type: Set("subscription".to_string()),
            tier: Set("pro".to_string()),
            features: Set(r#"["publish","batch","selector-updates"]"#.to_string()),
            lease_token: Set(lease_token),
            valid_from: Set(lic.activated_at.unwrap_or(lic.created_at).into()),
            valid_until: Set(valid_until.into()),
            min_extension_version: Set("0.1.0".to_string()),
            policy_version: Set(1),
            is_revoked: Set(false),
            ip_address: Set(ips[i as usize].to_string()),
            machine_hash: Set(machine_hash.clone()),
            client_install_id: Set(Some(machine_hash.clone())),
            platform: Set("unknown".to_string()),
            created_at: Set(created.into()),
            updated_at: Set(created.into()),
        }
        .insert(db)
        .await?;
    }

    tracing::info!("Seeded lease records for user {}", user_id);
    Ok(())
}
