use crate::AppState;

/// 从应用状态中提取服务的 Trait
///
/// 用于将应用状态转换为具体的服务实例，便于依赖注入。
pub trait FromState {
    /// 从应用状态中创建服务实例
    ///
    /// # 参数
    /// * `state` - 应用状态引用
    ///
    /// # 返回
    /// 返回由应用状态初始化的服务实例
    fn from_state(state: &AppState) -> Self;
}
