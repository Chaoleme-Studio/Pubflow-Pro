pub mod enums;

pub mod app_version;
pub mod lease;
pub mod license;
pub mod license_batch;
pub mod license_event;
pub mod license_replacement;
pub mod order;
pub mod product_catalog;
pub mod remote_asset;
pub mod remote_daily_usage;
pub mod remote_job;
pub mod remote_web_session;
pub mod selector;
pub mod user;

pub mod prelude {
    pub use super::app_version::Entity as AppVersion;
    pub use super::enums::*;
    pub use super::lease::Entity as Lease;
    pub use super::license::Entity as License;
    pub use super::license_batch::Entity as LicenseBatch;
    pub use super::license_event::Entity as LicenseEvent;
    pub use super::license_replacement::Entity as LicenseReplacement;
    pub use super::order::Entity as Order;
    pub use super::product_catalog::Entity as ProductCatalog;
    pub use super::remote_asset::Entity as RemoteAsset;
    pub use super::remote_daily_usage::Entity as RemoteDailyUsage;
    pub use super::remote_job::Entity as RemoteJob;
    pub use super::remote_web_session::Entity as RemoteWebSession;
    pub use super::selector::Entity as Selector;
    pub use super::user::Entity as User;
}
