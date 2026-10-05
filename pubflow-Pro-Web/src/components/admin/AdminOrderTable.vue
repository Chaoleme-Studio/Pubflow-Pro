<script setup lang="ts">
import type { AdminOrderItem } from '../../api';
import { formatDateTime, planLabel, shortHash, sourceLabel, statusLabel, tierLabel, toDateOnly, yuan } from '../../utils/format';

defineProps<{ items: AdminOrderItem[]; loading?: boolean }>();
</script>

<template>
  <div class="order-table-frame" :aria-busy="loading">
    <table>
      <colgroup><col class="order-main" /><col class="order-product" /><col class="order-license" /><col class="order-time" /><col class="order-amount" /></colgroup>
      <thead><tr><th>订单 / 渠道</th><th>商品 / 状态</th><th>授权</th><th>时间</th><th>金额</th></tr></thead>
      <tbody>
        <tr v-if="items.length === 0"><td colspan="5" class="table-empty">{{ loading ? '正在加载订单' : '暂无匹配订单' }}</td></tr>
        <tr v-for="item in items" :key="item.id">
          <td><strong :title="item.orderNo">{{ item.orderNo }}</strong><small>{{ sourceLabel(item.channel || '-') }}</small></td>
          <td><strong>{{ tierLabel(item.tier) }} · {{ planLabel(item.plan) }}</strong><small><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></small></td>
          <td><code :title="item.activationCode || '未发放'">{{ item.activationCode ? shortHash(item.activationCode) : '未发放' }}</code><small>到期 {{ item.expiresAt ? toDateOnly(item.expiresAt) : '未激活' }}</small></td>
          <td><strong>{{ item.paidAt ? formatDateTime(item.paidAt) : '未支付' }}</strong><small>创建 {{ formatDateTime(item.createdAt) }}</small></td>
          <td><strong>{{ yuan(item.amountCents || 0) }}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.order-table-frame {
  width: 100%;
  margin-top: 12px;
  overflow-x: auto;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  overscroll-behavior-x: contain;
}

table { width: 100%; min-width: 780px; table-layout: fixed; border-collapse: collapse; }
.order-main { width: 25%; }
.order-product { width: 18%; }
.order-license { width: 23%; }
.order-time { width: 25%; }
.order-amount { width: 110px; }
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
