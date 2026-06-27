import type { PlatformConfig } from '../platforms';
import { findDeepElement, isVisible } from './dom';

/** 检测页面上是否出现平台配置的拦截弹窗或阻断元素，返回对应提示文案。 */
export function detectBlocker(config: PlatformConfig): string {
  for (const blocker of config.blockers) {
    for (const selector of blocker.selectors) {
      if (findDeepElement(selector, isVisible)) return blocker.message;
    }
  }
  return '';
}
