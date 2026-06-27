import { ref } from 'vue';
import type { RuntimeMessage } from '../../types';

/** 组合式函数：管理侧边栏打开状态和开关。 */
export function useSidePanelStatus() {
  const sidePanelOpen = ref(false);

  /** 从后台刷新侧边栏当前是否打开。 */
  async function refreshSidePanelStatus() {
    const response = await browser.runtime.sendMessage({
      type: 'GET_SIDE_PANEL_STATUS',
    } satisfies RuntimeMessage) as { ok: boolean; data?: { open?: boolean } } | undefined;
    sidePanelOpen.value = !!response?.ok && !!response.data?.open;
  }

  /** 在当前标签页打开或重试打开侧边栏。 */
  async function toggleSidePanel() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await browser.sidePanel.open({ tabId: tab.id });
        sidePanelOpen.value = true;
      }
    } catch {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await browser.sidePanel.open({ tabId: tab.id });
      sidePanelOpen.value = true;
    }
  }

  /** 处理运行时消息中的侧边栏状态更新。 */
  function handleRuntimeMessage(message: RuntimeMessage) {
    if (message.type === 'SIDE_PANEL_STATUS') {
      sidePanelOpen.value = message.payload.open;
    }
  }

  return {
    sidePanelOpen,
    refreshSidePanelStatus,
    toggleSidePanel,
    handleRuntimeMessage,
  };
}
