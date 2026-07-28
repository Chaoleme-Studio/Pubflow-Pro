import { describe, expect, it, vi } from 'vitest';
import { InboundTaskCoordinator } from './inboundTaskCoordinator';

async function flushCoordinator() {
  await Promise.resolve();
}

describe('InboundTaskCoordinator', () => {
  it('always gives the native source the first claim opportunity', async () => {
    let nativeAvailable = true;
    const native = vi.fn(() => {
      const claimed = nativeAvailable;
      nativeAvailable = false;
      return claimed;
    });
    const cloud = vi.fn(() => true);
    const coordinator = new InboundTaskCoordinator(() => false);
    coordinator.setSources({ tryClaim: native }, { tryClaim: cloud });

    coordinator.notifyTaskMayBeAvailable();
    await flushCoordinator();
    expect(native).toHaveBeenCalledTimes(1);
    expect(cloud).not.toHaveBeenCalled();

    coordinator.claimSettled();
    await flushCoordinator();
    expect(native).toHaveBeenCalledTimes(2);
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it('does not claim while the shared executor is busy', async () => {
    const native = vi.fn(() => true);
    const cloud = vi.fn(() => true);
    const coordinator = new InboundTaskCoordinator(() => true);
    coordinator.setSources({ tryClaim: native }, { tryClaim: cloud });

    coordinator.notifyTaskMayBeAvailable();
    await flushCoordinator();
    expect(native).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  });
});
