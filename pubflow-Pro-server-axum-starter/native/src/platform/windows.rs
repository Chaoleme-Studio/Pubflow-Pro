//! Windows 平台机器码读取
//!
//! 读取注册表 HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
//! 这是一个安装时生成的 GUID，重装系统才会改变。

use std::process::Command;

pub fn get_machine_id() -> Option<String> {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // 输出格式：MachineGuid    REG_SZ    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("MachineGuid") {
            // 取最后一个空格分隔的部分
            return line.split_whitespace().last().map(|s| s.to_string());
        }
    }
    None
}
