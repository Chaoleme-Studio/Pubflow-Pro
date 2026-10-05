<script setup lang="ts">
import {
  Ban,
  Copy,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  ShieldOff,
  Snowflake,
  StickyNote,
  Trash2,
  Unlink,
} from 'lucide-vue-next';
import { onBeforeUnmount, ref } from 'vue';
import type { AdminLicenseItem } from '../../api';
import { formatDateTime, planLabel, sourceLabel, statusLabel, tierLabel, toDateOnly } from '../../utils/format';

const props = defineProps<{
  items: AdminLicenseItem[];
  selectedCodes: Set<string>;
  loading?: boolean;
}>();
const emit = defineEmits<{
  toggle: [item: AdminLicenseItem];
  note: [item: AdminLicenseItem];
  replace: [item: AdminLicenseItem];
  limits: [item: AdminLicenseItem];
  freeze: [item: AdminLicenseItem];
  unfreeze: [item: AdminLicenseItem];
  unbind: [item: AdminLicenseItem];
  revoke: [item: AdminLicenseItem];
  delete: [item: AdminLicenseItem];
}>();

const copiedCode = ref('');
let copiedTimer = 0;
type LicenseAction = 'note' | 'replace' | 'limits' | 'freeze' | 'unfreeze' | 'unbind' | 'revoke' | 'delete';

async function copyCode(code: string) {
  await navigator.clipboard.writeText(code);
  copiedCode.value = code;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedCode.value = '';
  }, 1400);
}

function runAction(event: Event, action: LicenseAction, item: AdminLicenseItem) {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  if (action === 'note') emit('note', item);
  if (action === 'replace') emit('replace', item);
  if (action === 'limits') emit('limits', item);
  if (action === 'freeze') emit('freeze', item);
  if (action === 'unfreeze') emit('unfreeze', item);
  if (action === 'unbind') emit('unbind', item);
  if (action === 'revoke') emit('revoke', item);
  if (action === 'delete') emit('delete', item);
}

onBeforeUnmount(() => window.clearTimeout(copiedTimer));
</script>

<template>
  <div class="admin-license-grid" :aria-busy="props.loading">
    <div v-if="props.loading && props.items.length === 0" class="license-grid-empty">
      <RefreshCw class="loading-icon" :size="18" />
      正在加载卡密
    </div>
    <div v-else-if="props.items.length === 0" class="license-grid-empty">
      <KeyRound :size="19" />
      没有符合条件的卡密
    </div>
    <article
      v-for="item in props.items"
      v-else
      :key="item.id"
      class="admin-license-card"
      :class="{ selected: props.selectedCodes.has(item.activationCode) }"
    >
      <header>
        <label class="license-card-check">
          <input
            type="checkbox"
            :checked="props.selectedCodes.has(item.activationCode)"
            :aria-label="`选择 ${item.activationCode}`"
            @change="emit('toggle', item)"
          />
        </label>
        <mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark>
        <span>{{ tierLabel(item.tier) }} · {{ planLabel(item.plan) }}</span>
      </header>

      <div class="license-card-code">
        <code :title="item.activationCode">{{ item.activationCode }}</code>
        <button type="button" :title="copiedCode === item.activationCode ? '已复制' : '复制激活码'" @click="copyCode(item.activationCode)">
          <Copy :size="15" />
        </button>
      </div>

      <button class="license-card-note" type="button" :title="item.note || '添加备注'" @click="emit('note', item)">
        <StickyNote :size="14" />
        <span>{{ item.note || '添加备注' }}</span>
      </button>

      <dl>
        <div><dt>批次</dt><dd :title="item.batchName || '无批次'">{{ item.batchName || '无批次' }}</dd></div>
        <div><dt>渠道</dt><dd>{{ sourceLabel(item.sourceChannel) }}</dd></div>
        <div><dt>激活</dt><dd>{{ item.activatedAt ? formatDateTime(item.activatedAt) : '未激活' }}</dd></div>
        <div><dt>到期</dt><dd>{{ item.expiresAt ? toDateOnly(item.expiresAt) : '未开始' }}</dd></div>
      </dl>

      <footer>
        <span>迁移 {{ item.deviceMigrationCount }}/{{ item.deviceMigrationLimit }}</span>
        <div class="license-card-actions">
          <button type="button" title="编辑备注" @click="emit('note', item)"><StickyNote :size="15" /></button>
          <details>
            <summary title="更多操作"><MoreHorizontal :size="17" /></summary>
            <div class="license-card-menu">
              <button type="button" @click="runAction($event, 'replace', item)"><RefreshCw :size="15" />补发卡密</button>
              <button type="button" @click="runAction($event, 'limits', item)"><Settings2 :size="15" />设备额度</button>
              <button v-if="item.status === 'revoked'" type="button" @click="runAction($event, 'unfreeze', item)"><ShieldOff :size="15" />解除冻结</button>
              <button v-else type="button" @click="runAction($event, 'freeze', item)"><Snowflake :size="15" />冻结授权</button>
              <button type="button" :disabled="item.clientInstallIds.length === 0" @click="runAction($event, 'unbind', item)"><Unlink :size="15" />解绑设备</button>
              <button class="danger" type="button" :disabled="item.status === 'revoked'" @click="runAction($event, 'revoke', item)"><Ban :size="15" />吊销卡密</button>
              <button class="danger" type="button" @click="runAction($event, 'delete', item)"><Trash2 :size="15" />删除卡密</button>
            </div>
          </details>
        </div>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.admin-license-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(268px, 100%), 1fr));
  gap: 10px;
  margin-top: 12px;
}

.admin-license-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, .025);
}

.admin-license-card.selected {
  border-color: var(--border-brand);
  background: rgba(54, 125, 255, .075);
}

header,
footer,
.license-card-code,
.license-card-note,
.license-card-actions {
  display: flex;
  align-items: center;
}

header {
  gap: 8px;
}

header > span {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.license-card-check {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
}

.license-card-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.license-card-code {
  gap: 6px;
  margin-top: 12px;
}

.license-card-code code {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--brand-400);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.license-card-code button,
.license-card-actions > button,
summary {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-3);
  background: transparent;
}

.license-card-note {
  width: 100%;
  min-width: 0;
  gap: 7px;
  margin-top: 8px;
  padding: 7px 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  background: rgba(0, 0, 0, .12);
  text-align: left;
}

.license-card-note span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px 12px;
  margin: 10px 0 0;
}

dl div {
  min-width: 0;
}

dt,
dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

dt { color: var(--text-4); }
dd { margin-top: 2px; color: var(--text-2); }

footer {
  min-height: 32px;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border-1);
  color: var(--text-4);
  font-size: 11px;
}

.license-card-actions { gap: 2px; }
details { position: relative; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }

.license-card-menu {
  width: 176px;
  position: absolute;
  right: 0;
  bottom: 36px;
  z-index: 8;
  padding: 5px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  background: var(--bg-2);
  box-shadow: 0 16px 40px rgba(0, 0, 0, .42);
  transform-origin: bottom right;
}

.license-card-menu button {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  background: transparent;
  font-size: 12px;
}

.license-card-menu button:hover:not(:disabled) { background: var(--surface-2); }
.license-card-menu button.danger { color: #ff9db4; }
.license-card-menu button:disabled { opacity: .38; }

button,
summary {
  transition: transform 140ms cubic-bezier(.23, 1, .32, 1), background-color 160ms ease;
}

button:active:not(:disabled),
summary:active { transform: scale(.97); }

.license-grid-empty {
  grid-column: 1 / -1;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
}

.loading-icon { animation: grid-spin .7s linear infinite; }
@keyframes grid-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  button,
  summary { transition: none; }
  .loading-icon { animation-duration: 1.2s; }
}
</style>
