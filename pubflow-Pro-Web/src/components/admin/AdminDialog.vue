<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();

watch(() => props.open, async (open) => {
  if (!open) return;
  await nextTick();
  panel.value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="admin-dialog-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
      @click.self="!props.busy && emit('close')"
      @keydown.escape="!props.busy && emit('close')"
    >
      <section ref="panel" class="admin-dialog-panel" tabindex="-1">
        <header>
          <div>
            <h2>{{ props.title }}</h2>
            <p v-if="props.description">{{ props.description }}</p>
          </div>
          <button type="button" title="关闭" :disabled="props.busy" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>
        <div class="admin-dialog-body">
          <slot />
        </div>
        <footer v-if="$slots.footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 14, .72);
  backdrop-filter: blur(6px);
}

.admin-dialog-panel {
  width: min(520px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border: 1px solid var(--border-3);
  border-radius: var(--radius);
  outline: none;
  background: var(--bg-2);
  box-shadow: var(--shadow-card);
  opacity: 1;
  transform: scale(1);
  transition: opacity 180ms cubic-bezier(.23, 1, .32, 1), transform 180ms cubic-bezier(.23, 1, .32, 1);
}

@starting-style {
  .admin-dialog-panel {
    opacity: 0;
    transform: scale(.96);
  }
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 17px 20px;
}

header {
  border-bottom: 1px solid var(--border-2);
}

header h2,
header p {
  margin: 0;
}

header h2 {
  font-size: 17px;
}

header p {
  margin-top: 4px;
  color: var(--text-3);
  font-size: 12px;
}

header button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-3);
  background: transparent;
}

.admin-dialog-body {
  padding: 20px;
}

footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border-2);
}

button {
  transition: transform 140ms cubic-bezier(.23, 1, .32, 1), background-color 160ms ease;
}

button:active:not(:disabled) {
  transform: scale(.96);
}

@media (prefers-reduced-motion: reduce) {
  .admin-dialog-panel {
    transform: none;
    transition-property: opacity;
  }
}
</style>
