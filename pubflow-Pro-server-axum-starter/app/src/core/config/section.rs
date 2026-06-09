use serde_json::Value;

/// 配置段的统一接口，支持灵活扩展
///
/// 这个 trait 定义了配置系统的扩展点，允许新的配置模块无需修改 AppConfig 结构
/// 就能集成进来。实现此 trait 的配置段可以支持从配置文件加载、环境变量覆盖、
/// 以及独立的验证逻辑
pub trait ConfigSection: Send + Sync {
    /// 获取配置段的名字（如 "server"、"database"）
    fn section_name(&self) -> &str;

    /// 从 JSON 值加载配置
    ///
    /// # 参数
    ///
    /// * `value` - 包含配置的 JSON 值
    ///
    /// # 返回值
    ///
    /// 成功返回 `Ok(())`，失败返回错误消息
    fn load_from_value(&mut self, value: &Value) -> Result<(), String>;

    /// 验证配置的有效性
    ///
    /// # 返回值
    ///
    /// 配置有效返回 `Ok(())`，无效返回错误消息
    fn validate(&self) -> Result<(), String>;

    /// 获取此配置段必需的环境变量列表
    ///
    /// # 返回值
    ///
    /// 环境变量名称列表，如 `["DATABASE_URL", "JWT_SECRET"]`
    fn required_env_vars(&self) -> Vec<&str> {
        vec![]
    }

    /// 应用环境变量覆盖（优先级最高）
    ///
    /// 在验证之前调用，用于将环境变量值应用到配置中。
    ///
    /// # 返回值
    ///
    /// 成功返回 `Ok(())`，失败返回错误消息
    fn apply_env_overrides(&mut self) -> Result<(), String> {
        Ok(())
    }
}
