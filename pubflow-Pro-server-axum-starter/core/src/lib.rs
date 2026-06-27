//! pubflow-core：共享核心库
//!
//! 所有 crate 的公共依赖，提供：
//! - License 结构体与 Ed25519 验签
//! - AES-256-GCM 对称加解密
//! - 设备机器码哈希算法
//! - Selector 解密逻辑
//! - 共享数据类型定义
//!
//! 此 crate 不依赖任何异步运行时（不依赖 tokio/web-sys），
//! 保证在 WASM、后端、Native Helper 三端通用。

pub mod crypto;
pub mod license;
pub mod machine;
pub mod selector;
pub mod selector_protocol;
pub mod types;
