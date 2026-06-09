<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
}>();

const emit = defineEmits<{
  'update:page': [value: number];
  'update:pageSize': [value: number];
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

const visiblePages = computed(() => {
  const pages: number[] = [];
  const tp = totalPages.value;
  const cp = props.page;
  if (tp <= 7) {
    for (let i = 1; i <= tp; i++) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (cp > 3) pages.push(-1); // ellipsis
  const start = Math.max(2, cp - 1);
  const end = Math.min(tp - 1, cp + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (cp < tp - 2) pages.push(-2); // ellipsis
  pages.push(tp);
  return pages;
});

const rangeStart = computed(() => props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1);
const rangeEnd = computed(() => Math.min(props.page * props.pageSize, props.total));

function go(p: number) {
  if (p >= 1 && p <= totalPages.value) emit('update:page', p);
}

function onPageSizeChange(e: Event) {
  const size = Number((e.target as HTMLSelectElement).value);
  emit('update:pageSize', size);
  emit('update:page', 1);
}
</script>

<template>
  <div v-if="total > 0" class="pagination-bar">
    <span class="page-info">{{ rangeStart }}-{{ rangeEnd }} / {{ total }}</span>
    <select class="page-size-select" :value="pageSize" @change="onPageSizeChange">
      <option v-for="s in (pageSizeOptions || [20, 50, 100])" :key="s" :value="s">{{ s }} 条/页</option>
    </select>
    <div class="page-nav">
      <button class="page-btn" type="button" :disabled="page <= 1" @click="go(page - 1)">&lsaquo;</button>
      <template v-for="p in visiblePages" :key="p">
        <span v-if="p < 0" class="page-ellipsis">&hellip;</span>
        <button v-else class="page-btn" :class="{ active: p === page }" type="button" @click="go(p)">{{ p }}</button>
      </template>
      <button class="page-btn" type="button" :disabled="page >= totalPages" @click="go(page + 1)">&rsaquo;</button>
    </div>
  </div>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 0 0 10px 10px;
  font-size: 13px;
  color: #64748b;
}

.page-info {
  font-size: 12px;
  white-space: nowrap;
}

.page-size-select {
  height: 28px;
  padding: 0 6px;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  font-size: 12px;
  color: #475569;
  background: #fff;
  cursor: pointer;
  outline: none;
}

.page-nav {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.page-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.12s;
}
.page-btn:hover:not(:disabled):not(.active) {
  background: #f1f5f9;
}
.page-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.page-btn.active {
  background: #6366f1;
  color: #fff;
  border-color: #6366f1;
}

.page-ellipsis {
  min-width: 20px;
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
}
</style>
