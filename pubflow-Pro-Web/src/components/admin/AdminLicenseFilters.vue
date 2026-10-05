<script setup lang="ts">
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import type { AdminLicenseBatchItem } from '../../api';
import type { LicenseFilters } from './licenseTypes';

const props = defineProps<{
  batches: AdminLicenseBatchItem[];
  loading?: boolean;
}>();
const emit = defineEmits<{
  apply: [];
  reset: [];
}>();
const filters = defineModel<LicenseFilters>({ required: true });
const showMore = ref(false);

const activeFilterCount = computed(() => {
  const value = filters.value;
  return [
    value.keyword,
    value.tier !== 'all' ? value.tier : '',
    value.plan !== 'all' ? value.plan : '',
    value.status !== 'all' ? value.status : '',
    value.batchId !== 'all' ? value.batchId : '',
    value.sourceChannel !== 'all' ? value.sourceChannel : '',
    value.createdFrom,
    value.createdTo,
  ].filter(Boolean).length;
});

function resetFilters() {
  showMore.value = false;
  emit('reset');
}
</script>

<template>
  <form class="license-filter-panel" @submit.prevent="emit('apply')">
    <div class="license-filter-primary">
      <label class="license-search-field">
        <span class="sr-only">搜索卡密</span>
        <Search :size="16" aria-hidden="true" />
        <input v-model="filters.keyword" placeholder="搜索激活码或备注" autocomplete="off" />
      </label>

      <label>
        <span>批次</span>
        <select v-model="filters.batchId">
          <option value="all">全部批次</option>
          <option v-for="batch in props.batches" :key="batch.id" :value="batch.id">
            {{ batch.batchName }}（{{ batch.quantity }}）
          </option>
        </select>
      </label>

      <label>
        <span>状态</span>
        <select v-model="filters.status">
          <option value="all">全部状态</option>
          <option value="pending">待激活</option>
          <option value="active">已激活</option>
          <option value="expired">已过期</option>
          <option value="revoked">已吊销</option>
        </select>
      </label>

      <div class="license-filter-actions">
        <button
          class="filter-more-button"
          type="button"
          :aria-expanded="showMore"
          title="更多筛选"
          @click="showMore = !showMore"
        >
          <SlidersHorizontal :size="16" />
          <span v-if="activeFilterCount" class="filter-count">{{ activeFilterCount }}</span>
        </button>
        <button class="secondary-button compact filter-reset-button" type="button" title="重置筛选" @click="resetFilters">
          <RotateCcw :size="15" />
        </button>
        <button class="primary-button compact" type="submit" :disabled="props.loading">
          {{ props.loading ? '查询中' : '查询' }}
        </button>
      </div>
    </div>

    <div v-if="showMore" class="license-filter-more">
      <label>
        <span>版本</span>
        <select v-model="filters.tier">
          <option value="all">全部版本</option>
          <option value="basic">Basic</option>
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <label>
        <span>套餐</span>
        <select v-model="filters.plan">
          <option value="all">全部套餐</option>
          <option value="monthly">月卡</option>
          <option value="yearly">年卡</option>
        </select>
      </label>
      <label>
        <span>渠道</span>
        <select v-model="filters.sourceChannel">
          <option value="all">全部渠道</option>
          <option value="manual">手动发放</option>
          <option value="third_party">三方平台</option>
          <option value="official">官网订单</option>
          <option value="test">测试</option>
        </select>
      </label>
      <label>
        <span>创建开始</span>
        <input v-model="filters.createdFrom" type="date" />
      </label>
      <label>
        <span>创建结束</span>
        <input v-model="filters.createdTo" type="date" />
      </label>
    </div>
  </form>
</template>

<style scoped>
.license-filter-panel {
  padding: 12px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
}

.license-filter-primary {
  display: grid;
  grid-template-columns: minmax(240px, 2fr) minmax(180px, 1fr) minmax(140px, .75fr) auto;
  gap: 10px;
  align-items: end;
}

label {
  min-width: 0;
}

label > span:not(.sr-only) {
  display: block;
  margin-bottom: 6px;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
}

input,
select {
  width: 100%;
  height: 38px;
}

.license-search-field {
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

.license-search-field:focus-within {
  border-color: var(--border-brand);
}

.license-search-field input {
  height: auto;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.license-filter-actions {
  height: 38px;
  display: flex;
  align-items: stretch;
  gap: 7px;
}

.filter-more-button,
.filter-reset-button {
  width: 38px;
  min-width: 38px;
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
  position: absolute;
  top: -6px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  padding: 0 4px;
  border-radius: 9px;
  color: white;
  background: var(--brand);
  font-size: 10px;
  font-weight: 800;
}

.license-filter-more {
  display: grid;
  grid-template-columns: repeat(5, minmax(130px, 1fr));
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-1);
}

button {
  transition: transform 140ms var(--ease-out, cubic-bezier(.23, 1, .32, 1)), border-color 160ms ease;
}

button:active {
  transform: scale(.97);
}

@media (max-width: 1120px) {
  .license-filter-primary {
    grid-template-columns: minmax(220px, 1.5fr) minmax(170px, 1fr) minmax(130px, .8fr);
  }

  .license-filter-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .license-filter-more {
    grid-template-columns: repeat(3, minmax(130px, 1fr));
  }
}

@media (max-width: 720px) {
  .license-filter-primary,
  .license-filter-more {
    grid-template-columns: 1fr 1fr;
  }

  .license-search-field,
  .license-filter-actions {
    grid-column: 1 / -1;
  }
}

</style>
