import { ref } from 'vue';
import type { RuntimeMessage } from '../../types';

export function useSidePanelStatus() {
  const sidePanelOpen = ref(false);

  async function refreshSidePanelStatus() {
    const response = await browser.runtime.sendMessage({
      type: 'GET_SIDE_PANEL_STATUS',
    } satisfies RuntimeMessage) as { ok: boolean; data?: { open?: boolean } } | undefined;
    sidePanelOpen.value = !!response?.ok && !!response.data?.open;
  }

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
