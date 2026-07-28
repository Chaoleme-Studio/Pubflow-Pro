export interface ClaimableTaskSource {
  tryClaim(): boolean;
}

/** 本地 Native 与云端共享的唯一领取锁；空闲时固定本地优先。 */
export class InboundTaskCoordinator {
  private nativeSource: ClaimableTaskSource | null = null;
  private cloudSource: ClaimableTaskSource | null = null;
  private claimInFlight = false;
  private scheduled = false;

  constructor(private readonly isExecutorBusy: () => boolean) {}

  setSources(nativeSource: ClaimableTaskSource, cloudSource: ClaimableTaskSource) {
    this.nativeSource = nativeSource;
    this.cloudSource = cloudSource;
  }

  notifyTaskMayBeAvailable() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.tryClaim();
    });
  }

  claimSettled() {
    this.claimInFlight = false;
    this.notifyTaskMayBeAvailable();
  }

  private tryClaim() {
    if (this.claimInFlight || this.isExecutorBusy()) return;
    if (this.nativeSource?.tryClaim()) {
      this.claimInFlight = true;
      return;
    }
    if (this.cloudSource?.tryClaim()) this.claimInFlight = true;
  }
}
