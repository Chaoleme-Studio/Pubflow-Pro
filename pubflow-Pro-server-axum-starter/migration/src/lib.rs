pub use sea_orm_migration::prelude::*;

mod m20220101_000001_create_user_table;
mod m20260524_000001_create_pubflow_tables;
mod m20260525_000001_create_product_catalog;
mod m20260528_000001_create_lease_table;
mod m20260528_000002_add_lease_ip_address;
mod m20260528_000003_add_performance_indexes;
mod m20260609_000001_license_activation_events;
mod m20260609_000002_allow_unactivated_license_without_expiry;
mod m20260609_000003_add_client_install_id;
mod m20260623_000001_add_device_migration_fields;
mod m20260626_000001_product_ops_license_replacement;
mod m20260627_000001_create_app_versions;
mod m20260701_000001_add_app_version_mirror_url;
mod m20260701_000002_normalize_extension_download_urls;
mod m20260704_000001_add_browser_device_key_to_leases;
mod m20260704_000002_add_admin_audit_fields_to_license_events;
mod m20260705_000001_add_deleted_at_to_licenses;
mod m20260726_000001_remote_publish;
mod m20260727_000001_license_tiers;
mod m20260804_000001_add_license_note;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20220101_000001_create_user_table::Migration),
            Box::new(m20260524_000001_create_pubflow_tables::Migration),
            Box::new(m20260525_000001_create_product_catalog::Migration),
            Box::new(m20260528_000001_create_lease_table::Migration),
            Box::new(m20260528_000002_add_lease_ip_address::Migration),
            Box::new(m20260528_000003_add_performance_indexes::Migration),
            Box::new(m20260609_000001_license_activation_events::Migration),
            Box::new(m20260609_000002_allow_unactivated_license_without_expiry::Migration),
            Box::new(m20260609_000003_add_client_install_id::Migration),
            Box::new(m20260623_000001_add_device_migration_fields::Migration),
            Box::new(m20260626_000001_product_ops_license_replacement::Migration),
            Box::new(m20260627_000001_create_app_versions::Migration),
            Box::new(m20260701_000001_add_app_version_mirror_url::Migration),
            Box::new(m20260701_000002_normalize_extension_download_urls::Migration),
            Box::new(m20260704_000001_add_browser_device_key_to_leases::Migration),
            Box::new(m20260704_000002_add_admin_audit_fields_to_license_events::Migration),
            Box::new(m20260705_000001_add_deleted_at_to_licenses::Migration),
            Box::new(m20260726_000001_remote_publish::Migration),
            Box::new(m20260727_000001_license_tiers::Migration),
            Box::new(m20260804_000001_add_license_note::Migration),
        ]
    }
}
