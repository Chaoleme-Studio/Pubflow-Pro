use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::section::ConfigSection;

/// 自定义反序列化函数，支持多种格式的清理间隔
fn deserialize_cleanup_interval<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;

    // 优先尝试解析为数字
    if let Some(num) = value.as_u64() {
        return Ok(num);
    }

    // 尝试解析为字符串
    if let Some(s) = value.as_str() {
        let s = s.trim().to_lowercase();

        // 处理 "7x24" 格式
        if let Some(x_pos) = s.find('x') {
            let left = s[..x_pos]
                .trim()
                .parse::<u64>()
                .map_err(|_| serde::de::Error::custom(format!("无效的清理间隔格式: {}", s)))?;
            let right = s[x_pos + 1..]
                .trim()
                .parse::<u64>()
                .map_err(|_| serde::de::Error::custom(format!("无效的清理间隔格式: {}", s)))?;
            return Ok(left * right);
        }

        // 处理 "7d" 格式（天数）
        if s.ends_with('d') {
            let num = s[..s.len() - 1]
                .trim()
                .parse::<u64>()
                .map_err(|_| serde::de::Error::custom(format!("无效的清理间隔格式: {}", s)))?;
            return Ok(num * 24);
        }

        // 处理 "168h" 格式（小时）
        if s.ends_with('h') {
            let num = s[..s.len() - 1]
                .trim()
                .parse::<u64>()
                .map_err(|_| serde::de::Error::custom(format!("无效的清理间隔格式: {}", s)))?;
            return Ok(num);
        }

        // 尝试直接解析为数字字符串
        return s.parse::<u64>().map_err(|_| {
            serde::de::Error::custom(format!(
                "无效的清理间隔格式: {}，支持格式: 168、\"7x24\"、\"7d\"、\"168h\"",
                s
            ))
        });
    }

    Err(serde::de::Error::custom("清理间隔必须是数字或字符串格式"))
}

/// 日志系统配置
///
/// 包含日志级别、输出目标、格式、文件轮转和清理策略等配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LoggingConfig {
    /// 日志级别（trace、debug、info、warn、error）（默认：info）
    pub level: String,

    /// 控制台日志格式（pretty、compact），文件日志始终使用 JSON（默认：pretty）
    pub console_format: String,

    /// 是否输出日志到控制台（默认：true）
    pub console: bool,

    /// 是否输出日志到文件（默认：false）
    pub file: bool,

    /// 日志文件存储目录（默认：./logs）
    pub file_dir: String,

    /// 日志文件名前缀（默认：app）
    pub file_prefix: String,

    /// 日志文件轮转方式（daily、hourly、never）（默认：daily）
    pub rotation: String,

    /// 保留的日志文件数量（0 表示不限制）（默认：30）
    pub max_files: usize,

    /// 是否启用旧日志文件自动清理（默认：true）
    pub cleanup_enabled: bool,

    /// 日志清理间隔，单位小时（0 表示应用启动时立即清理，仅清理一次）（默认：168 即 7x24 小时）
    #[serde(deserialize_with = "deserialize_cleanup_interval")]
    pub cleanup_interval: u64,
}

impl LoggingConfig {
    /// 获取带环境标签的文件前缀
    ///
    /// 在 debug/trace 级别下添加 "-dev" 后缀，其他级别添加 "-prod" 后缀。
    ///
    /// # 返回值
    ///
    /// 格式为 "{file_prefix}{env_suffix}" 的文件前缀
    pub fn get_file_prefix_with_env(&self) -> String {
        let env_suffix = match self.level.as_str() {
            "trace" | "debug" => "-dev",
            _ => "-prod",
        };
        format!("{}{}", self.file_prefix, env_suffix)
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            console_format: "pretty".to_string(),
            console: true,
            file: false,
            file_dir: "./logs".to_string(),
            file_prefix: "app".to_string(),
            rotation: "daily".to_string(),
            max_files: 30,
            cleanup_enabled: true,
            cleanup_interval: 168,
        }
    }
}

impl ConfigSection for LoggingConfig {
    fn section_name(&self) -> &str {
        "logging"
    }

    fn load_from_value(&mut self, value: &Value) -> Result<(), String> {
        if let Some(obj) = value.as_object() {
            if let Some(level) = obj.get("level").and_then(|v| v.as_str()) {
                self.level = level.to_string();
            }
            if let Some(format) = obj.get("console_format").and_then(|v| v.as_str()) {
                self.console_format = format.to_string();
            }
            if let Some(console) = obj.get("console").and_then(|v| v.as_bool()) {
                self.console = console;
            }
            if let Some(file) = obj.get("file").and_then(|v| v.as_bool()) {
                self.file = file;
            }
            if let Some(dir) = obj.get("file_dir").and_then(|v| v.as_str()) {
                self.file_dir = dir.to_string();
            }
            if let Some(prefix) = obj.get("file_prefix").and_then(|v| v.as_str()) {
                self.file_prefix = prefix.to_string();
            }
            if let Some(rotation) = obj.get("rotation").and_then(|v| v.as_str()) {
                self.rotation = rotation.to_string();
            }
            if let Some(max_files) = obj.get("max_files").and_then(|v| v.as_u64()) {
                self.max_files = max_files as usize;
            }
            if let Some(cleanup_enabled) = obj.get("cleanup_enabled").and_then(|v| v.as_bool()) {
                self.cleanup_enabled = cleanup_enabled;
            }
            if let Some(interval_value) = obj.get("cleanup_interval") {
                // 支持多种格式：数字、"7x24"、"7d"、"168h" 等
                // 复用 deserialize_cleanup_interval 相同的解析逻辑
                if let Some(num) = interval_value.as_u64() {
                    self.cleanup_interval = num;
                } else if let Some(s) = interval_value.as_str() {
                    let s = s.trim().to_lowercase();
                    if let Some(x_pos) = s.find('x') {
                        let left: u64 = s[..x_pos]
                            .trim()
                            .parse()
                            .map_err(|_| format!("无效的清理间隔格式: {}", s))?;
                        let right: u64 = s[x_pos + 1..]
                            .trim()
                            .parse()
                            .map_err(|_| format!("无效的清理间隔格式: {}", s))?;
                        self.cleanup_interval = left * right;
                    } else if s.ends_with('d') {
                        let num: u64 = s[..s.len() - 1]
                            .trim()
                            .parse()
                            .map_err(|_| format!("无效的清理间隔格式: {}", s))?;
                        self.cleanup_interval = num * 24;
                    } else if s.ends_with('h') {
                        let num: u64 = s[..s.len() - 1]
                            .trim()
                            .parse()
                            .map_err(|_| format!("无效的清理间隔格式: {}", s))?;
                        self.cleanup_interval = num;
                    } else {
                        self.cleanup_interval = s
                            .parse()
                            .map_err(|_| format!("无效的清理间隔格式: {}", s))?;
                    }
                }
            }
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        match self.level.as_str() {
            "trace" | "debug" | "info" | "warn" | "error" => {}
            _ => return Err(format!("无效的日志级别：{}", self.level)),
        }
        match self.console_format.as_str() {
            "pretty" | "compact" => {}
            _ => return Err(format!("无效的控制台日志格式：{}", self.console_format)),
        }
        match self.rotation.as_str() {
            "daily" | "hourly" | "never" => {}
            _ => return Err(format!("无效的日志轮转方式：{}", self.rotation)),
        }
        Ok(())
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        // 所有环境变量覆盖已由 config-rs 中的 Environment 源处理（APP_ 前缀）
        // 这里可以添加特殊处理逻辑（如有需要）
        Ok(())
    }
}
