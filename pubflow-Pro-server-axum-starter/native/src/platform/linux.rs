//! Linux 平台机器码读取
//!
//! 读取 /etc/machine-id
//! 这是 systemd 生成的机器标识，重装系统才会改变。
//! 部分发行版可能在 /var/lib/dbus/machine-id

use std::fs;

pub fn get_machine_id() -> Option<String> {
    // 优先读 /etc/machine-id
    if let Ok(id) = fs::read_to_string("/etc/machine-id") {
        let id = id.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    // 备选 /var/lib/dbus/machine-id
    if let Ok(id) = fs::read_to_string("/var/lib/dbus/machine-id") {
        let id = id.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    None
}
