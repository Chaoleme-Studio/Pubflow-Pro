pub use sea_orm_migration::prelude::*;

mod m20220101_000001_create_user_table;
mod m20260524_000001_create_pubflow_tables;
mod m20260525_000001_create_product_catalog;
mod m20260528_000001_create_lease_table;
mod m20260528_000002_add_lease_ip_address;
mod m20260528_000003_add_performance_indexes;
mod m20260609_000001_license_activation_events;

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
        ]
    }
}
