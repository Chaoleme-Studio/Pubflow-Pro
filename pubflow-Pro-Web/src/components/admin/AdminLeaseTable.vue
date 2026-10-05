<script setup lang="ts">
import type { AdminLeaseItem } from '../../api';
import { eventLabel, formatDateTime, shortHash, statusLabel } from '../../utils/format';

defineProps<{ items: AdminLeaseItem[]; loading?: boolean }>();
</script>

<template>
  <div class="lease-table-frame" :aria-busy="loading">
    <table>
      <colgroup><col class="lease-time" /><col class="lease-event" /><col class="lease-code" /><col class="lease-actor" /><col class="lease-device" /><col class="lease-detail" /></colgroup>
      <thead><tr><th>时间</th><th>事件 / 结果</th><th>激活码</th><th>操作者 / 目标</th><th>安装实例 / 平台</th><th>到期 / 原因</th></tr></thead>
      <tbody>
        <tr v-if="items.length === 0"><td colspan="6" class="table-empty">{{ loading ? '正在加载授权记录' : '暂无授权记录' }}</td></tr>
        <tr v-for="item in items" :key="item.id">
          <td>{{ formatDateTime(item.createdAt) }}</td>
          <td><strong>{{ eventLabel(item.eventType) }}</strong><small><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></small></td>
          <td><code :title="item.activationCode">{{ shortHash(item.activationCode) }}</code></td>
          <td><strong>{{ item.operator || '-' }}</strong><small :title="item.targetId || ''">目标 {{ item.targetId ? shortHash(item.targetId) : '-' }}</small></td>
          <td><strong><code :title="item.clientInstallId">{{ shortHash(item.clientInstallId) }}</code></strong><small>{{ item.platform || '-' }} · {{ item.ipAddress || '-' }}</small></td>
          <td><strong>{{ item.expiresAt ? formatDateTime(item.expiresAt) : '-' }}</strong><small :title="item.reason || ''">{{ item.reason || '无补充原因' }}</small></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.lease-table-frame {
  width: 100%;
  margin-top: 12px;
  overflow-x: auto;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  overscroll-behavior-x: contain;
}

table { width: 100%; min-width: 940px; table-layout: fixed; border-collapse: collapse; }
.lease-time { width: 154px; }
.lease-event { width: 150px; }
.lease-code { width: 150px; }
.lease-actor { width: 160px; }
.lease-device { width: 190px; }
.lease-detail { width: 210px; }
th,
td { padding: 8px 11px; border-bottom: 1px solid var(--border-1); text-align: left; }
th { height: 38px; color: var(--text-4); background: var(--bg-2); font-size: 11px; }
td { height: 54px; overflow: hidden; color: var(--text-2); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
tbody tr:last-child td { border-bottom: 0; }
strong,
small { display: block; overflow: hidden; text-overflow: ellipsis; }
small { margin-top: 4px; color: var(--text-4); font-size: 11px; }
code { color: var(--brand-400); }
.table-empty { height: 150px; color: var(--text-3); text-align: center; }
</style>
