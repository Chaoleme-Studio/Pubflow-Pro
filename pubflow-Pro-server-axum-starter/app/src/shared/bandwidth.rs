use std::{sync::Arc, time::Duration};

use tokio::{
    sync::{Mutex, OwnedSemaphorePermit, Semaphore},
    time::{Instant, sleep_until},
};

#[derive(Debug)]
pub struct RemoteTransferLimiter {
    bytes_per_second: u64,
    slots: Arc<Semaphore>,
    next_available: Mutex<Instant>,
}

impl RemoteTransferLimiter {
    pub fn new(bytes_per_second: u64, max_concurrent_transfers: usize) -> Self {
        Self {
            bytes_per_second,
            slots: Arc::new(Semaphore::new(max_concurrent_transfers)),
            next_available: Mutex::new(Instant::now()),
        }
    }

    pub async fn acquire(&self) -> OwnedSemaphorePermit {
        self.slots
            .clone()
            .acquire_owned()
            .await
            .expect("remote transfer semaphore must remain open")
    }

    pub async fn pace(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        let spacing = Duration::from_secs_f64(bytes as f64 / self.bytes_per_second as f64);
        let scheduled_at = {
            let mut next_available = self.next_available.lock().await;
            let now = Instant::now();
            if *next_available < now {
                *next_available = now;
            }
            let scheduled_at = *next_available;
            *next_available += spacing;
            scheduled_at
        };
        sleep_until(scheduled_at).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tokio::time::{Duration, timeout};

    use super::RemoteTransferLimiter;

    #[tokio::test]
    async fn limits_concurrent_transfers() {
        let limiter = Arc::new(RemoteTransferLimiter::new(1024, 1));
        let first = limiter.acquire().await;
        assert!(
            timeout(Duration::from_millis(10), limiter.acquire())
                .await
                .is_err()
        );
        drop(first);
        assert!(
            timeout(Duration::from_millis(10), limiter.acquire())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn shares_one_byte_rate_between_transfers() {
        let limiter = Arc::new(RemoteTransferLimiter::new(1_000, 2));
        let started_at = tokio::time::Instant::now();
        tokio::join!(limiter.pace(50), limiter.pace(50));
        assert!(started_at.elapsed() >= Duration::from_millis(40));
    }
}
