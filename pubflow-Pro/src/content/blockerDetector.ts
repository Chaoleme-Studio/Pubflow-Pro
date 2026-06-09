import type { PlatformConfig } from '../platforms';
import { findDeepElement, isVisible } from './dom';

export function detectBlocker(config: PlatformConfig): string {
  for (const blocker of config.blockers) {
    for (const selector of blocker.selectors) {
      if (findDeepElement(selector, isVisible)) return blocker.message;
    }
  }
  return '';
}
