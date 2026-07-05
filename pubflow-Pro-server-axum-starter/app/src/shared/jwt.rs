use chrono::Utc;
use jsonwebtoken::{
    DecodingKey, EncodingKey, Header, TokenData, Validation, decode, decode_header, encode,
};
use serde::{Deserialize, Serialize};

/// JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// 用户 ID
    pub sub: i32,

    /// 过期时间（Unix timestamp）
    pub exp: i64,

    /// 签发时间（Unix timestamp）
    pub iat: i64,
}

impl Claims {
    /// 创建新的 claims，默认过期时间为 7 天
    pub fn new(user_id: i32, expires_in_secs: i64) -> Self {
        let now = Utc::now().timestamp();
        Self {
            sub: user_id,
            exp: now + expires_in_secs,
            iat: now,
        }
    }
}

/// JWT 服务
#[derive(Clone, Debug)]
pub struct JwtService {
    encoding_key: EncodingKey,
    active_key_version: i32,
    decoding_keys: Vec<JwtDecodingKey>,
}

#[derive(Clone, Debug)]
struct JwtDecodingKey {
    version: Option<i32>,
    key: DecodingKey,
}

impl JwtService {
    /// 创建新的 JWT 服务
    pub fn new(secret: String) -> Self {
        Self::with_key_versions(secret, 1, Vec::new())
    }

    /// 创建支持密钥轮换的 JWT 服务。
    ///
    /// previous_secrets 格式为 `(key_version, secret)`；无 `kid` 的旧 token 会按 active + previous 顺序尝试。
    pub fn with_key_versions(
        secret: String,
        active_key_version: i32,
        previous_secrets: Vec<(i32, String)>,
    ) -> Self {
        let mut decoding_keys = Vec::with_capacity(previous_secrets.len() + 1);
        decoding_keys.push(JwtDecodingKey {
            version: Some(active_key_version),
            key: DecodingKey::from_secret(secret.as_bytes()),
        });
        decoding_keys.extend(previous_secrets.into_iter().map(|(version, secret)| {
            JwtDecodingKey {
                version: Some(version),
                key: DecodingKey::from_secret(secret.as_bytes()),
            }
        }));
        Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            active_key_version,
            decoding_keys,
        }
    }

    pub fn active_key_version(&self) -> i32 {
        self.active_key_version
    }

    /// 生成 JWT token
    ///
    /// # 参数
    /// * `user_id` - 用户 ID
    /// * `expires_in_secs` - 过期时间（秒）
    ///
    /// # 返回
    /// 返回生成的 token 字符串
    pub fn generate_token(
        &self,
        user_id: i32,
        expires_in_secs: i64,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = Claims::new(user_id, expires_in_secs);
        encode(&self.header(), &claims, &self.encoding_key)
    }

    /// 生成自定义 claims 的 JWT token（用于 lease）
    ///
    /// # 参数
    /// * `custom_claims` - 自定义 claims（必须实现 Serialize）
    /// * `expires_in_secs` - 过期时间（秒）
    ///
    /// # 返回
    /// 返回生成的 token 字符串
    pub fn generate_token_with_claims<T: Serialize>(
        &self,
        custom_claims: &T,
        expires_in_secs: i64,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        // 将自定义 claims 转换为 serde_json::Value
        let mut claims_value = serde_json::to_value(custom_claims)
            .map_err(|_| jsonwebtoken::errors::ErrorKind::InvalidSubject)?;

        // 添加标准 JWT claims
        let now = Utc::now().timestamp();
        if let Some(obj) = claims_value.as_object_mut() {
            obj.insert(
                "exp".to_string(),
                serde_json::Value::Number((now + expires_in_secs).into()),
            );
            obj.insert("iat".to_string(), serde_json::Value::Number(now.into()));
        }

        encode(&self.header(), &claims_value, &self.encoding_key)
    }

    /// 验证并解析 JWT token
    ///
    /// # 参数
    /// * `token` - JWT token 字符串
    ///
    /// # 返回
    /// 返回解析后的 token 数据，包含 claims 和 header
    pub fn verify_token(
        &self,
        token: &str,
    ) -> Result<TokenData<Claims>, jsonwebtoken::errors::Error> {
        self.decode_with_rotation(token)
    }

    /// 验证并解析自定义 claims 的 JWT token（用于 lease）
    ///
    /// # 参数
    /// * `token` - JWT token 字符串
    ///
    /// # 返回
    /// 返回解析后的 serde_json::Value
    pub fn verify_token_custom(
        &self,
        token: &str,
    ) -> Result<serde_json::Value, jsonwebtoken::errors::Error> {
        let token_data = self.decode_value_with_rotation(token)?;
        Ok(token_data.claims)
    }

    /// 从 token 中提取用户 ID
    ///
    /// # 参数
    /// * `token` - JWT token 字符串
    ///
    /// # 返回
    /// 返回用户 ID，如果 token 无效或过期则返回错误
    pub fn extract_user_id(&self, token: &str) -> Result<i32, jsonwebtoken::errors::Error> {
        self.verify_token(token).map(|data| data.claims.sub)
    }

    fn header(&self) -> Header {
        let mut header = Header::default();
        header.kid = Some(self.active_key_version.to_string());
        header
    }

    fn decode_with_rotation<T>(
        &self,
        token: &str,
    ) -> Result<TokenData<T>, jsonwebtoken::errors::Error>
    where
        T: for<'de> Deserialize<'de>,
    {
        let validation = Validation::default();
        if let Some(kid) = decode_header(token).ok().and_then(|header| header.kid)
            && let Ok(version) = kid.parse::<i32>()
            && let Some(key) = self
                .decoding_keys
                .iter()
                .find(|candidate| candidate.version == Some(version))
        {
            return decode::<T>(token, &key.key, &validation);
        }

        let mut last_error = None;
        for key in &self.decoding_keys {
            match decode::<T>(token, &key.key, &validation) {
                Ok(data) => return Ok(data),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| {
            jsonwebtoken::errors::Error::from(jsonwebtoken::errors::ErrorKind::InvalidToken)
        }))
    }

    fn decode_value_with_rotation(
        &self,
        token: &str,
    ) -> Result<TokenData<serde_json::Value>, jsonwebtoken::errors::Error> {
        self.decode_with_rotation(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTIVE_SECRET: &str = "active-secret-active-secret-active-secret";
    const OLD_SECRET: &str = "old-secret-old-secret-old-secret-old-secret";

    #[test]
    fn generated_token_uses_active_key_version_in_header() {
        let service = JwtService::with_key_versions(ACTIVE_SECRET.to_string(), 7, Vec::new());

        let token = service.generate_token(1, 60).unwrap();
        let header = decode_header(&token).unwrap();

        assert_eq!(header.kid.as_deref(), Some("7"));
    }

    #[test]
    fn verifies_previous_key_during_rotation() {
        let old_service = JwtService::with_key_versions(OLD_SECRET.to_string(), 1, Vec::new());
        let token = old_service.generate_token(1, 60).unwrap();
        let rotated_service = JwtService::with_key_versions(
            ACTIVE_SECRET.to_string(),
            2,
            vec![(1, OLD_SECRET.to_string())],
        );

        let claims = rotated_service.verify_token(&token).unwrap().claims;

        assert_eq!(claims.sub, 1);
    }
}
