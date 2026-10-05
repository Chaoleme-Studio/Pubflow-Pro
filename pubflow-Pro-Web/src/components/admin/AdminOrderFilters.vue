<script setup lang="ts">
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import type { OrderFilters } from './orderTypes';

const props = defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ apply: []; reset: [] }>();
const filters = defineModel<OrderFilters>({ required: true });
const showMore = ref(false);

const activeFilterCount = computed(() => [
  filters.value.keyword,
  filters.value.tier !== 'all' ? filters.value.tier : '',
  filters.value.plan !== 'all' ? filters.value.plan : '',
  filters.value.status !== 'all' ? filters.value.status : '',
  filters.value.paidFrom,
  filters.value.paidTo,
  filters.value.expiresFrom,
  filters.value.expiresTo,
].filter(Boolean).length);

function reset() {
  showMore.value = false;
  emit('reset');
}
</script>

<template>
  <form class="order-filter-panel" @submit.prevent="emit('apply')">
    <div class="order-filter-primary">
      <label class="order-search-field">
        <span class="sr-only">搜索订单</span>
        <Search :size="16" />
        <input v-model="filters.keyword" placeholder="订单号、渠道、授权码" autocomplete="off" />
      </label>
      <label>
        <span>订单状态</span>
        <select v-model="filters.status">
          <option value="all">全部状态</option>
          <option value="pending">待支付</option>
          <option value="paid">已支付</option>
          <option value="amount_mismatch">金额异常</option>
        </select>
      </label>
      <div class="order-filter-actions">
        <button class="icon-button" type="button" title="更多筛选" :aria-expanded="showMore" @click="showMore = !showMore">
          <SlidersHorizontal :size="16" />
          <span v-if="activeFilterCount" class="filter-count">{{ activeFilterCount }}</span>
        </button>
        <button class="icon-button" type="button" title="重置筛选" @click="reset"><RotateCcw :size="15" /></button>
        <button class="primary-button compact" type="submit" :disabled="props.loading">{{ props.loading ? '查询中' : '查询' }}</button>
      </div>
    </div>
    <div v-if="showMore" class="order-filter-more">
      <label><span>版本</span><select v-model="filters.tier"><option value="all">全部版本</option><option value="basic">Basic</option><option value="plus">Plus</option><option value="pro">Pro</option></select></label>
      <label><span>套餐</span><select v-model="filters.plan"><option value="all">全部套餐</option><option value="monthly">月卡</option><option value="yearly">年卡</option></select></label>
      <label><span>购买开始</span><input v-model="filters.paidFrom" type="date" /></label>
      <label><span>购买结束</span><input v-model="filters.paidTo" type="date" /></label>
      <label><span>到期开始</span><input v-model="filters.expiresFrom" type="date" /></label>
      <label><span>到期结束</span><input v-model="filters.expiresTo" type="date" /></label>
    </div>
  </form>
</template>

<style scoped>
.order-filter-panel {
  padding: 12px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
}

.order-filter-primary {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(150px, 220px) auto;
  gap: 10px;
  align-items: end;
}

label { min-width: 0; }
label > span:not(.sr-only) {
  display: block;
  margin-bottom: 6px;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
}

input,
select { width: 100%; height: 38px; }

.order-search-field {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-4);
  background: rgba(0, 0, 0, .2);
}

.order-search-field input {
  height: auto;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.order-filter-actions { height: 38px; display: flex; gap: 7px; }
.icon-button {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  position: relative;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  background: var(--surface-2);
}

.filter-count {
  min-width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  position: absolute;
  top: -6px;
  right: -5px;
  padding: 0 4px;
  border-radius: 9px;
  color: #fff;
  background: var(--brand);
  font-size: 10px;
}

.order-filter-more {
  display: grid;
  grid-template-columns: repeat(6, minmax(130px, 1fr));
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-1);
}

button { transition: transform 140ms cubic-bezier(.23, 1, .32, 1), border-color 160ms ease; }
button:active:not(:disabled) { transform: scale(.97); }

@media (max-width: 1050px) {
  .order-filter-more { grid-template-columns: repeat(3, minmax(130px, 1fr)); }
}

@media (max-width: 620px) {
  .order-filter-primary { grid-template-columns: 1fr 1fr; }
  .order-search-field { grid-column: 1 / -1; }
  .order-filter-more { grid-template-columns: 1fr 1fr; }
  .order-filter-actions { justify-content: flex-end; }
}
</style>
