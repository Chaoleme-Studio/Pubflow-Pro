//! 平台分发模块
//!
//! 根据编译目标操作系统，分发到对应的机器码读取实现。
//!
//! - windows: MachineGuid（注册表 HKLM\SOFTWARE\Microsoft\Cryptography）
//! - macos: IOPlatformUUID（ioreg -rd1 -c IOPlatformExpertDevice）
//! - linux: /etc/machine-id

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// 获取系统级原始机器码
pub fn get_raw_machine_id() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        windows::get_machine_id()
    }

    #[cfg(target_os = "macos")]
    {
        macos::get_machine_id()
    }

    #[cfg(target_os = "linux")]
    {
        linux::get_machine_id()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// 获取操作系统平台名称
pub fn get_platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }

    #[cfg(target_os = "macos")]
    {
        "macos"
    }

    #[cfg(target_os = "linux")]
    {
        "linux"
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown"
    }
}
