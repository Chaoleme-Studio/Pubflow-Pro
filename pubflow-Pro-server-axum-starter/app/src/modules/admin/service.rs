use chrono::{DateTime, NaiveDate, Utc};
use entity::{lease, license, license_batch, order, user};
use std::collections::BTreeSet;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::{new_activation_code, normalize_plan};
use crate::{AppState, ValidationError};

use super::dto::{
    AdminLoginRequest, AdminLoginResponse, GenerateLicenseRequest, GenerateLicenseResponse,
    LicenseItem, LicenseSummary, ListLicenseQuery, ListOrderQuery, ListUserQuery,
    OrderOperationItem, RevokeLicenseRequest, RevokeLicenseResponse, UserOperationItem,
};

pub struct AdminService {
    db: DatabaseConnection,
    jwt_service: crate::shared::jwt::JwtService,
    admin_username: String,
    admin_password_hash: String,
}

impl FromState for AdminService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            jwt_service: state.jwt_service.clone(),
            admin_username: state.config.admin_username.clone(),
            admin_password_hash: state.config.admin_password_hash.clone(),
        }
    }
}

impl AdminService {
    pub fn login(&self, req: AdminLoginRequest) -> Result<AdminLoginResponse, crate::AppError> {
        let username = req.username.trim();

        if username != self.admin_username {
            return Err(crate::error::AuthError::InvalidPassword.into());
        }

        // 使用 Argon2 验证密码哈希
        let is_valid =
            crate::shared::password::verify_password(&req.password, &self.admin_password_hash)
                .map_err(|_| crate::error::AuthError::InvalidPassword)?;

        if !is_valid {
            return Err(crate::error::AuthError::InvalidPassword.into());
        }

        // 生成 JWT token（admin 使用 sub=-1 标识，有效期 24 小时）
        let token = self
            .jwt_service
            .generate_token(-1, 24 * 3600)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;

        Ok(AdminLoginResponse {
            token,
            username: self.admin_username.clone(),
        })
    }

    pub async fn generate_licenses(
        &self,
        req: GenerateLicenseRequest,
    ) -> Result<GenerateLicenseResponse, crate::AppError> {
        let plan = normalize_plan(&req.plan)?;
        let quantity = req.quantity.unwrap_or(1).clamp(1, 100);
        let max_devices = req.max_devices.unwrap_or(1).clamp(1, 20);
        let now = Utc::now();
        let sales_channel =
            trim_string(req.sales_channel).unwrap_or_else(|| "third_party".to_string());
        let batch_name = trim_string(req.batch_name)
            .unwrap_or_else(|| format!("{}-{}", sales_channel, now.format("%Y%m%d%H%M%S")));

        let txn = self.db.begin().await?;
        let batch = license_batch::ActiveModel {
            id: Set(Uuid::new_v4()),
            batch_name: Set(batch_name),
            sales_channel: Set(sales_channel.clone()),
            plan: Set(plan.to_string()),
            quantity: Set(quantity as i32),
            max_devices: Set(max_devices),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;
        let mut items = Vec::with_capacity(quantity as usize);

        for _ in 0..quantity {
            let inserted = license::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(None),
                activation_code: Set(new_activation_code()),
                tier: Set("pro".to_string()),
                plan: Set(plan.to_string()),
                source_channel: Set(sales_channel.clone()),
                batch_id: Set(Some(batch.id)),
                max_devices: Set(max_devices),
                activated_at: Set(None),
                expires_at: Set(None),
                is_revoked: Set(false),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(&txn)
            .await?;
            items.push(to_license_item(
                inserted,
                Vec::new(),
                None,
                Some(batch.clone()),
            ));
        }

        txn.commit().await?;
        Ok(GenerateLicenseResponse { items })
    }

    pub async fn revoke_license(
        &self,
        req: RevokeLicenseRequest,
    ) -> Result<RevokeLicenseResponse, crate::AppError> {
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        let mut active: license::ActiveModel = license_model.into();
        active.is_revoked = Set(true);
        active.updated_at = Set(Utc::now().into());
        active.update(&self.db).await?;

        Ok(RevokeLicenseResponse { revoked: true })
    }

    pub async fn list_licenses(
        &self,
        query: ListLicenseQuery,
    ) -> Result<(Vec<LicenseItem>, u64, u64, u64, LicenseSummary), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = license::Entity::find();

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(license::Column::ActivationCode.contains(keyword.clone()))
                    .add(license::Column::Tier.contains(keyword)),
            );
        }
        if let Some(code) = trim_opt(&query.activation_code) {
            stmt = stmt.filter(license::Column::ActivationCode.contains(code));
        }
        if let Some(tier) = trim_opt(&query.tier) {
            stmt = stmt.filter(license::Column::Tier.eq(tier));
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(license::Column::Plan.eq(plan));
        }
        if let Some(is_revoked) = query.is_revoked {
            stmt = stmt.filter(license::Column::IsRevoked.eq(is_revoked));
        }
        if let Some(from) = parse_date_start(query.created_from.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.created_to.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.lte(to));
        }
        if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.lte(to));
        }

        let paginator = stmt.paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联的 lease 和 order，避免 N+1
        let license_ids: Vec<_> = rows.iter().map(|r| r.id).collect();
        let all_leases = lease::Entity::find()
            .filter(lease::Column::LicenseId.is_in(license_ids.clone()))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&self.db)
            .await?;
        let all_orders = order::Entity::find()
            .filter(order::Column::LicenseId.is_in(license_ids))
            .all(&self.db)
            .await?;
        let batch_ids: Vec<_> = rows.iter().filter_map(|r| r.batch_id).collect();
        let batches_map: std::collections::HashMap<uuid::Uuid, _> = if batch_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            license_batch::Entity::find()
                .filter(license_batch::Column::Id.is_in(batch_ids))
                .all(&self.db)
                .await?
                .into_iter()
                .map(|batch| (batch.id, batch))
                .collect()
        };

        let mut leases_by_license: std::collections::HashMap<_, Vec<_>> =
            std::collections::HashMap::new();
        for l in all_leases {
            leases_by_license.entry(l.license_id).or_default().push(l);
        }
        let mut orders_by_license: std::collections::HashMap<uuid::Uuid, _> =
            std::collections::HashMap::new();
        for o in all_orders.into_iter().filter(|o| o.license_id.is_some()) {
            orders_by_license.entry(o.license_id.unwrap()).or_insert(o);
        }

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let leases = leases_by_license.get(&row.id).cloned().unwrap_or_default();
            let related_order = orders_by_license.remove(&row.id);
            let machine_hashes: Vec<String> = leases
                .iter()
                .map(|l| l.machine_hash.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            if let Some(hash) = trim_opt(&query.machine_hash)
                && !machine_hashes.iter().any(|item| item.contains(&hash))
            {
                continue;
            }
            if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
                if !related_order
                    .as_ref()
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
                if !related_order
                    .as_ref()
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at <= to)
                {
                    continue;
                }
            }
            let related_batch = row.batch_id.and_then(|id| batches_map.get(&id).cloned());
            items.push(to_license_item(
                row,
                machine_hashes,
                related_order,
                related_batch,
            ));
        }

        // 计算汇总统计
        let summary = self.get_license_summary(&query).await?;

        Ok((items, total, page, page_size, summary))
    }

    async fn get_license_summary(
        &self,
        query: &ListLicenseQuery,
    ) -> Result<LicenseSummary, crate::AppError> {
        let mut stmt = license::Entity::find();

        // 应用相同的过滤条件
        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(license::Column::ActivationCode.contains(keyword.clone()))
                    .add(license::Column::Tier.contains(keyword)),
            );
        }
        if let Some(code) = trim_opt(&query.activation_code) {
            stmt = stmt.filter(license::Column::ActivationCode.contains(code));
        }
        if let Some(tier) = trim_opt(&query.tier) {
            stmt = stmt.filter(license::Column::Tier.eq(tier));
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(license::Column::Plan.eq(plan));
        }
        if let Some(is_revoked) = query.is_revoked {
            stmt = stmt.filter(license::Column::IsRevoked.eq(is_revoked));
        }
        if let Some(from) = parse_date_start(query.created_from.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.created_to.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.lte(to));
        }
        if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.lte(to));
        }

        let all_licenses = stmt.all(&self.db).await?;
        let total = all_licenses.len() as i64;

        let license_ids: Vec<_> = all_licenses.iter().map(|l| l.id).collect();

        // 批量查询关联订单金额，避免 N+1
        let order_amounts: std::collections::HashMap<uuid::Uuid, i32> = if license_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            let all_orders = order::Entity::find()
                .filter(order::Column::LicenseId.is_in(license_ids))
                .all(&self.db)
                .await?;
            let mut amounts: std::collections::HashMap<uuid::Uuid, i32> =
                std::collections::HashMap::new();
            for o in all_orders.into_iter() {
                if let Some(lid) = o.license_id {
                    *amounts.entry(lid).or_insert(0) += o.amount_cents;
                }
            }
            amounts
        };

        let mut pending = 0i64;
        let mut active = 0i64;
        let mut revenue_cents = 0i64;

        for lic in &all_licenses {
            if lic.is_revoked {
                // 已吊销不计入 pending/active
            } else if lic.activated_at.is_some() {
                active += 1;
            } else {
                pending += 1;
            }

            revenue_cents += order_amounts.get(&lic.id).copied().unwrap_or(0) as i64;
        }

        Ok(LicenseSummary {
            total,
            pending,
            active,
            revenue_cents,
        })
    }

    pub async fn list_users(
        &self,
        query: ListUserQuery,
    ) -> Result<(Vec<UserOperationItem>, u64, u64, u64), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = user::Entity::find();

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(user::Column::Username.contains(keyword.clone()))
                    .add(user::Column::Email.contains(keyword)),
            );
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = stmt.filter(user::Column::Status.eq(status_to_code(&status)?));
        }

        let paginator = stmt.paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联数据，避免 N+1
        let user_ids: Vec<_> = rows.iter().map(|r| r.id).collect();
        let all_licenses = license::Entity::find()
            .filter(license::Column::UserId.is_in(user_ids.clone()))
            .all(&self.db)
            .await?;
        let all_license_ids: Vec<_> = all_licenses.iter().map(|l| l.id).collect();
        let all_leases = if all_license_ids.is_empty() {
            vec![]
        } else {
            lease::Entity::find()
                .filter(lease::Column::LicenseId.is_in(all_license_ids.clone()))
                .filter(lease::Column::IsRevoked.eq(false))
                .all(&self.db)
                .await?
        };
        let all_orders = if all_license_ids.is_empty() {
            vec![]
        } else {
            order::Entity::find()
                .filter(order::Column::LicenseId.is_in(all_license_ids))
                .all(&self.db)
                .await?
        };

        // 按 user_id 分组 licenses
        let mut licenses_by_user: std::collections::HashMap<_, Vec<_>> =
            std::collections::HashMap::new();
        for lic in all_licenses {
            if let Some(uid) = lic.user_id {
                licenses_by_user.entry(uid).or_default().push(lic);
            }
        }
        // 按 license_id 分组 leases
        let mut leases_by_license: std::collections::HashMap<uuid::Uuid, Vec<_>> =
            std::collections::HashMap::new();
        for l in all_leases {
            leases_by_license.entry(l.license_id).or_default().push(l);
        }
        // 按 license_id 分组 orders
        let mut orders_by_license: std::collections::HashMap<uuid::Uuid, Vec<_>> =
            std::collections::HashMap::new();
        for o in all_orders.into_iter() {
            if let Some(lid) = o.license_id {
                orders_by_license.entry(lid).or_default().push(o);
            }
        }

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let licenses = licenses_by_user.remove(&row.id).unwrap_or_default();
            let license_ids: Vec<_> = licenses.iter().map(|l| l.id).collect();

            let mut machine_hashes_set = BTreeSet::new();
            let mut related_orders = Vec::new();
            for lid in &license_ids {
                if let Some(leases) = leases_by_license.get(lid) {
                    for l in leases {
                        machine_hashes_set.insert(l.machine_hash.clone());
                    }
                }
                if let Some(orders) = orders_by_license.get(lid) {
                    related_orders.extend_from_slice(orders);
                }
            }
            related_orders.sort_by_key(|item| item.paid_at.or(Some(item.created_at)));
            related_orders.reverse();

            let machine_hashes = machine_hashes_set.into_iter().collect::<Vec<_>>();

            if let Some(hash) = trim_opt(&query.machine_hash)
                && !machine_hashes.iter().any(|item| item.contains(&hash))
            {
                continue;
            }

            let latest_order = related_orders.first();
            let latest_license = licenses.iter().max_by_key(|license| license.created_at);

            if let Some(plan) = trim_opt(&query.plan)
                && latest_order
                    .map(|order| order.plan.as_str())
                    .or_else(|| latest_license.map(|license| license.plan.as_str()))
                    != Some(plan.as_str())
            {
                continue;
            }
            if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
                if !latest_order
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
                if !latest_order
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at <= to)
                {
                    continue;
                }
            }
            if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
                if !latest_license
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
                if !latest_license
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at <= to)
                {
                    continue;
                }
            }

            let source = latest_order.map(|order| order.channel.clone());
            let plan = latest_order
                .map(|order| order.plan.clone())
                .or_else(|| latest_license.map(|license| license.plan.clone()));

            items.push(UserOperationItem {
                id: row.id,
                username: row.username,
                email: row.email,
                status: user_status_label(row.status).to_string(),
                plan,
                source,
                machine_hashes,
                license_count: licenses.len(),
                order_no: latest_order.map(|order| order.order_no.clone()),
                amount_cents: latest_order.map(|order| order.amount_cents),
                paid_at: latest_order
                    .and_then(|order| order.paid_at.map(|value| value.with_timezone(&Utc))),
                created_at: row.created_at.with_timezone(&Utc),
                expires_at: latest_license
                    .and_then(|license| license.expires_at.map(|value| value.with_timezone(&Utc))),
            });
        }

        Ok((items, total, page, page_size))
    }

    pub async fn list_orders(
        &self,
        query: ListOrderQuery,
    ) -> Result<(Vec<OrderOperationItem>, u64, u64, u64), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = order::Entity::find();

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(order::Column::OrderNo.contains(keyword.clone()))
                    .add(order::Column::ActivationCode.contains(keyword.clone()))
                    .add(order::Column::Channel.contains(keyword.clone()))
                    .add(order::Column::Status.contains(keyword.clone()))
                    .add(order::Column::MachineHash.contains(keyword)),
            );
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(order::Column::Plan.eq(plan));
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = stmt.filter(order::Column::Status.eq(status));
        }
        if let Some(hash) = trim_opt(&query.machine_hash) {
            stmt = stmt.filter(order::Column::MachineHash.contains(hash));
        }
        if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
            stmt = stmt.filter(order::Column::PaidAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
            stmt = stmt.filter(order::Column::PaidAt.lte(to));
        }

        let paginator = stmt.paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联的 license，避免 N+1
        let license_ids: Vec<_> = rows.iter().filter_map(|r| r.license_id).collect();
        let licenses_map: std::collections::HashMap<uuid::Uuid, _> = if license_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            license::Entity::find()
                .filter(license::Column::Id.is_in(license_ids))
                .all(&self.db)
                .await?
                .into_iter()
                .map(|l| (l.id, l))
                .collect()
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let license_model = row.license_id.and_then(|lid| licenses_map.get(&lid));
            if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
                if !license_model
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
                if !license_model
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at <= to)
                {
                    continue;
                }
            }

            items.push(OrderOperationItem {
                id: row.id.to_string(),
                order_no: row.order_no,
                plan: row.plan,
                channel: row.channel,
                status: row.status,
                machine_hash: row.machine_hash,
                activation_code: row.activation_code,
                amount_cents: row.amount_cents,
                paid_at: row.paid_at.map(|value| value.with_timezone(&Utc)),
                created_at: row.created_at.with_timezone(&Utc),
                updated_at: row.updated_at.with_timezone(&Utc),
                expires_at: license_model
                    .and_then(|license| license.expires_at.map(|value| value.with_timezone(&Utc))),
            });
        }

        Ok((items, total, page, page_size))
    }
}

fn user_status_label(status: i16) -> &'static str {
    match status {
        0 => "active",
        1 => "disabled",
        2 => "deleted",
        _ => "unknown",
    }
}

fn status_to_code(status: &str) -> Result<i16, ValidationError> {
    match status {
        "active" => Ok(0),
        "disabled" => Ok(1),
        "deleted" => Ok(2),
        _ => Err(ValidationError::custom(
            "status 必须是 active、disabled 或 deleted",
        )),
    }
}

fn to_license_item(
    row: license::Model,
    machine_hashes: Vec<String>,
    related_order: Option<order::Model>,
    related_batch: Option<license_batch::Model>,
) -> LicenseItem {
    let (order_no, order_channel, amount_cents, paid_at, plan) = if let Some(order) = related_order
    {
        (
            Some(order.order_no),
            Some(order.channel),
            Some(order.amount_cents),
            order.paid_at.map(|value| value.with_timezone(&Utc)),
            order.plan,
        )
    } else {
        (None, None, None, None, row.plan.clone())
    };
    let status = license_status(&row);

    LicenseItem {
        id: row.id.to_string(),
        activation_code: row.activation_code,
        tier: row.tier,
        plan,
        status,
        source_channel: row.source_channel,
        batch_id: row.batch_id.map(|id| id.to_string()),
        batch_name: related_batch.map(|batch| batch.batch_name),
        user_id: row.user_id,
        max_devices: row.max_devices,
        is_revoked: row.is_revoked,
        machine_hashes,
        order_no,
        order_channel,
        amount_cents,
        paid_at,
        created_at: row.created_at.with_timezone(&Utc),
        expires_at: row.expires_at.map(|value| value.with_timezone(&Utc)),
        activated_at: row.activated_at.map(|value| value.with_timezone(&Utc)),
    }
}

fn license_status(row: &license::Model) -> String {
    if row.is_revoked {
        return "revoked".to_string();
    }
    match row.expires_at {
        Some(expires_at) if expires_at.with_timezone(&Utc) < Utc::now() => "expired".to_string(),
        Some(_) => "active".to_string(),
        None => "pending".to_string(),
    }
}

fn trim_opt(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn trim_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_date_start(value: Option<&str>) -> Result<Option<DateTime<Utc>>, ValidationError> {
    parse_date_bound(value, false)
}

fn parse_date_end(value: Option<&str>) -> Result<Option<DateTime<Utc>>, ValidationError> {
    parse_date_bound(value, true)
}

fn parse_date_bound(
    value: Option<&str>,
    end_of_day: bool,
) -> Result<Option<DateTime<Utc>>, ValidationError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ValidationError::custom("日期格式必须是 YYYY-MM-DD"))?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)
    } else {
        date.and_hms_opt(0, 0, 0)
    }
    .ok_or_else(|| ValidationError::custom("日期无效"))?;
    Ok(Some(
        DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc).into(),
    ))
}
