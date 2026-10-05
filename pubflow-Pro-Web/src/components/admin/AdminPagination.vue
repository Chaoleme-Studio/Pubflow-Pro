<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { computed } from 'vue';

const props = defineProps<{
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
}>();
const emit = defineEmits<{
  'update:page': [value: number];
  'update:pageSize': [value: number];
  change: [];
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

function setPage(value: number) {
  emit('update:page', Math.min(totalPages.value, Math.max(1, value)));
  emit('change');
}

function setPageSize(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  emit('update:pageSize', value);
  emit('update:page', 1);
  emit('change');
}
</script>

<template>
  <footer class="admin-pagination" aria-label="分页">
    <span>共 {{ props.total }} 条</span>
    <div class="admin-pagination-controls">
      <label>
        <span class="sr-only">每页数量</span>
        <select :value="props.pageSize" :disabled="props.loading" @change="setPageSize">
          <option :value="10">10 条/页</option>
          <option :value="20">20 条/页</option>
          <option :value="50">50 条/页</option>
          <option :value="100">100 条/页</option>
        </select>
      </label>
      <button type="button" title="上一页" :disabled="props.loading || props.page <= 1" @click="setPage(props.page - 1)">
        <ChevronLeft :size="17" />
      </button>
      <strong>{{ Math.min(props.page, totalPages) }} / {{ totalPages }}</strong>
      <button type="button" title="下一页" :disabled="props.loading || props.page >= totalPages" @click="setPage(props.page + 1)">
        <ChevronRight :size="17" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.admin-pagination,
.admin-pagination-controls {
  display: flex;
  align-items: center;
}

.admin-pagination {
  min-height: 52px;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 2px 0;
  color: var(--text-3);
  font-size: 13px;
}

.admin-pagination-controls {
  gap: 7px;
}

select {
  height: 32px;
  padding: 0 28px 0 9px;
  font-size: 12px;
}

button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  background: var(--surface-2);
  transition: transform 140ms cubic-bezier(.23, 1, .32, 1), border-color 160ms ease;
}

button:active:not(:disabled) {
  transform: scale(.96);
}

strong {
  min-width: 62px;
  text-align: center;
  color: var(--text-2);
  font-size: 12px;
}

@media (max-width: 520px) {
  .admin-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
