use std::{net::IpAddr, time::Duration};

use axum::http::Request;
use tower_governor::{
    GovernorError,
    key_extractor::{KeyExtractor, PeerIpKeyExtractor, SmartIpKeyExtractor},
};

/// Trust proxy forwarding headers only when the TCP peer is this host's reverse proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedProxyIpKeyExtractor;

/// tower-governor 的 `per_second(n)` 表示每 n 秒补一个令牌，并不是 n RPS。
/// 所有按“每秒请求数”配置的入口统一通过这个函数换算补充周期。
pub fn requests_per_second_period(requests_per_second: u32) -> Duration {
    assert!(
        requests_per_second > 0,
        "requests_per_second must be positive"
    );
    Duration::from_nanos(1_000_000_000_u64.div_ceil(u64::from(requests_per_second)))
}

impl KeyExtractor for TrustedProxyIpKeyExtractor {
    type Key = IpAddr;

    fn name(&self) -> &'static str {
        "trusted proxy IP"
    }

    fn extract<T>(&self, request: &Request<T>) -> Result<Self::Key, GovernorError> {
        let peer_ip = PeerIpKeyExtractor.extract(request)?;
        if peer_ip.is_loopback() {
            SmartIpKeyExtractor.extract(request).or(Ok(peer_ip))
        } else {
            Ok(peer_ip)
        }
    }

    fn key_name(&self, key: &Self::Key) -> Option<String> {
        Some(key.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        net::{IpAddr, SocketAddr},
        time::Duration,
    };

    use axum::extract::ConnectInfo;
    use axum::http::{HeaderValue, Request, header};
    use tower_governor::key_extractor::KeyExtractor;

    use super::{TrustedProxyIpKeyExtractor, requests_per_second_period};

    fn request(peer: &str, forwarded_for: &str) -> Request<()> {
        let mut request = Request::new(());
        request.extensions_mut().insert(ConnectInfo(
            peer.parse::<SocketAddr>().expect("valid peer address"),
        ));
        request.headers_mut().insert(
            header::HeaderName::from_static("x-forwarded-for"),
            HeaderValue::from_str(forwarded_for).expect("valid forwarded IP"),
        );
        request
    }

    #[test]
    fn uses_forwarded_ip_from_loopback_proxy() {
        let request = request("127.0.0.1:5189", "203.0.113.8");
        assert_eq!(
            TrustedProxyIpKeyExtractor.extract(&request).unwrap(),
            "203.0.113.8".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn ignores_spoofed_forwarded_ip_on_direct_connection() {
        let request = request("198.51.100.4:32000", "203.0.113.8");
        assert_eq!(
            TrustedProxyIpKeyExtractor.extract(&request).unwrap(),
            "198.51.100.4".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn converts_rps_to_token_period() {
        assert_eq!(requests_per_second_period(20), Duration::from_millis(50));
        assert_eq!(requests_per_second_period(1), Duration::from_secs(1));
    }
}
