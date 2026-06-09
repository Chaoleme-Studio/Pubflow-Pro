//! macOS 平台机器码读取
//!
//! 读取 IOPlatformUUID，通过 ioreg 命令获取。
//! 这是主板级别的唯一标识，刷机/换主板才会改变。

use std::process::Command;

pub fn get_machine_id() -> Option<String> {
    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // 查找 "IOPlatformUUID" = "XXXX-XXXX-..."
    for line in stdout.lines() {
        let line = line.trim();
        if line.contains("IOPlatformUUID") {
            // 格式："IOPlatformUUID" = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            if let Some(start) = line.rfind('"') {
                // 从右往左找最后一个引号前的值
                let rest = &line[..start];
                if let Some(mid) = rest.rfind('"') {
                    let value_start = mid + 1;
                    if value_start < start {
                        return Some(rest[value_start..start].to_string());
                    }
                }
            }
        }
    }
    None
}
