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
  'toggle-page': [];
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
const menuItem = ref<AdminLicenseItem>();
const menuPosition = ref({ top: 0, left: 0 });
let copiedTimer = 0;
type LicenseAction = 'note' | 'replace' | 'limits' | 'freeze' | 'unfreeze' | 'unbind' | 'revoke' | 'delete';

function openMenu(event: MouseEvent, item: AdminLicenseItem) {
  if (menuItem.value?.id === item.id) {
    closeMenu();
    return;
  }
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  const menuWidth = 190;
  const estimatedHeight = 316;
  const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
  const top = window.innerHeight - rect.bottom >= estimatedHeight
    ? rect.bottom + 6
    : Math.max(12, rect.top - estimatedHeight - 6);
  menuPosition.value = { top, left };
  menuItem.value = item;
}

function closeMenu() {
  menuItem.value = undefined;
}

function runAction(action: LicenseAction, item: AdminLicenseItem) {
  closeMenu();
  if (action === 'note') emit('note', item);
  if (action === 'replace') emit('replace', item);
  if (action === 'limits') emit('limits', item);
  if (action === 'freeze') emit('freeze', item);
  if (action === 'unfreeze') emit('unfreeze', item);
  if (action === 'unbind') emit('unbind', item);
  if (action === 'revoke') emit('revoke', item);
  if (action === 'delete') emit('delete', item);
}

async function copyCode(code: string) {
  await navigator.clipboard.writeText(code);
  copiedCode.value = code;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedCode.value = '';
  }, 1400);
}

onBeforeUnmount(() => window.clearTimeout(copiedTimer));
</script>

<template>
  <div class="license-table-frame" :aria-busy="props.loading">
    <table class="license-data-table">
      <colgroup>
        <col class="col-select" />
        <col class="col-code" />
        <col class="col-note" />
        <col class="col-plan" />
        <col class="col-status" />
        <col class="col-batch" />
        <col class="col-date" />
        <col class="col-date" />
        <col class="col-date" />
        <col class="col-migrations" />
        <col class="col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th class="license-select-cell">
            <input
              type="checkbox"
              aria-label="选择当前页"
              :checked="props.items.length > 0 && props.items.every((item) => props.selectedCodes.has(item.activationCode))"
              @change="emit('toggle-page')"
            />
          </th>
          <th>激活码</th>
          <th>备注</th>
          <th>版本 / 套餐</th>
          <th>状态</th>
          <th>批次 / 渠道</th>
          <th>激活时间</th>
          <th>到期时间</th>
          <th>创建时间</th>
          <th>迁移</th>
          <th class="sticky-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="props.loading && props.items.length === 0">
          <td colspan="11" class="license-table-empty">
            <RefreshCw class="loading-icon" :size="18" />
            正在加载卡密
          </td>
        </tr>
        <tr v-else-if="props.items.length === 0">
          <td colspan="11" class="license-table-empty">
            <KeyRound :size="19" />
            没有符合条件的卡密
          </td>
        </tr>
        <tr v-for="item in props.items" :key="item.id" :class="{ selected: props.selectedCodes.has(item.activationCode) }">
          <td class="license-select-cell">
            <input
              type="checkbox"
              :aria-label="`选择 ${item.activationCode}`"
              :checked="props.selectedCodes.has(item.activationCode)"
              @change="emit('toggle', item)"
            />
          </td>
          <td>
            <div class="license-code-cell">
              <code>{{ item.activationCode }}</code>
              <button type="button" :title="copiedCode === item.activationCode ? '已复制' : '复制激活码'" @click="copyCode(item.activationCode)">
                <Copy :size="14" />
              </button>
            </div>
          </td>
          <td>
            <button class="license-note-cell" type="button" :title="item.note || '添加备注'" @click="emit('note', item)">
              <StickyNote :size="14" />
              <span>{{ item.note || '添加备注' }}</span>
            </button>
          </td>
          <td>
            <strong class="license-plan">{{ tierLabel(item.tier) }}</strong>
            <small>{{ planLabel(item.plan) }}</small>
          </td>
          <td><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></td>
          <td>
            <strong class="license-batch-name" :title="item.batchName || '无批次'">{{ item.batchName || '无批次' }}</strong>
            <small>{{ sourceLabel(item.sourceChannel) }}</small>
          </td>
          <td>{{ item.activatedAt ? formatDateTime(item.activatedAt) : '未激活' }}</td>
          <td>{{ item.expiresAt ? toDateOnly(item.expiresAt) : '未开始' }}</td>
          <td>{{ toDateOnly(item.createdAt) }}</td>
          <td>{{ item.deviceMigrationCount }}/{{ item.deviceMigrationLimit }}</td>
          <td class="sticky-actions">
            <div class="license-row-actions">
              <button type="button" title="编辑备注" @click="emit('note', item)">
                <StickyNote :size="15" />
              </button>
              <button type="button" title="更多操作" :aria-expanded="menuItem?.id === item.id" @click="openMenu($event, item)">
                <MoreHorizontal :size="17" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <Teleport to="body">
    <button v-if="menuItem" class="license-menu-backdrop" type="button" aria-label="关闭操作菜单" @click="closeMenu"></button>
    <div
      v-if="menuItem"
      class="license-action-menu"
      role="menu"
      :style="{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }"
    >
      <button type="button" role="menuitem" @click="runAction('note', menuItem)"><StickyNote :size="15" />编辑备注</button>
      <button type="button" role="menuitem" @click="runAction('replace', menuItem)"><RefreshCw :size="15" />补发卡密</button>
      <button type="button" role="menuitem" @click="runAction('limits', menuItem)"><Settings2 :size="15" />设备额度</button>
      <button v-if="menuItem.status === 'revoked'" type="button" role="menuitem" @click="runAction('unfreeze', menuItem)"><ShieldOff :size="15" />解除冻结</button>
      <button v-else type="button" role="menuitem" @click="runAction('freeze', menuItem)"><Snowflake :size="15" />冻结授权</button>
      <button type="button" role="menuitem" :disabled="menuItem.clientInstallIds.length === 0" @click="runAction('unbind', menuItem)"><Unlink :size="15" />解绑设备</button>
      <div class="license-menu-separator"></div>
      <button class="danger" type="button" role="menuitem" :disabled="menuItem.status === 'revoked'" @click="runAction('revoke', menuItem)"><Ban :size="15" />吊销卡密</button>
      <button class="danger" type="button" role="menuitem" @click="runAction('delete', menuItem)"><Trash2 :size="15" />删除卡密</button>
    </div>
  </Teleport>
</template>

<style scoped>
.license-table-frame {
  width: 100%;
  margin-top: 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border: 1px solid var(--border-1);
  border-radius: var(--radius);
  background: rgba(0, 0, 0, .12);
}

.license-data-table {
  width: 100%;
  min-width: 1324px;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
}

.col-select { width: 44px; }

.col-code { width: 196px; }
.col-note { width: 184px; }
.col-plan { width: 116px; }
.col-status { width: 94px; }
.col-batch { width: 170px; }
.col-date { width: 148px; }
.col-migrations { width: 72px; }
.col-actions { width: 88px; }

th,
td {
  height: 54px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border-1);
  overflow: hidden;
  color: var(--text-2);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

th {
  height: 40px;
  position: sticky;
  top: 0;
  z-index: 2;
  color: var(--text-4);
  background: var(--bg-2);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover td {
  background: rgba(255, 255, 255, .025);
}

tbody tr.selected td {
  background: rgba(54, 125, 255, .075);
}

.license-select-cell {
  padding-right: 6px;
  padding-left: 11px;
  overflow: visible;
  text-align: center;
}

.license-select-cell input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.sticky-actions {
  position: sticky;
  right: 0;
  z-index: 1;
  border-left: 1px solid var(--border-1);
  background: var(--bg-2);
}

th.sticky-actions {
  z-index: 3;
}

.license-code-cell,
.license-row-actions,
.license-note-cell {
  display: flex;
  align-items: center;
}

.license-code-cell {
  gap: 6px;
}

.license-code-cell code {
  min-width: 0;
  overflow: hidden;
  color: var(--brand-400);
  text-overflow: ellipsis;
}

.license-code-cell button,
.license-row-actions button {
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
  transition: transform 140ms cubic-bezier(.23, 1, .32, 1), color 160ms ease, background-color 160ms ease;
}

.license-code-cell button:active,
.license-row-actions button:active {
  transform: scale(.95);
}

.license-row-actions {
  justify-content: flex-end;
  gap: 2px;
}

.license-note-cell {
  width: 100%;
  gap: 7px;
  padding: 0;
  border: 0;
  color: var(--text-3);
  background: transparent;
  text-align: left;
}

.license-note-cell span,
.license-batch-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.license-note-cell span {
  flex: 1;
}

.license-plan,
.license-batch-name,
td small {
  display: block;
}

td small {
  margin-top: 3px;
  color: var(--text-4);
  font-size: 11px;
}

.license-table-empty {
  height: 150px;
  color: var(--text-3);
  text-align: center;
}

.license-table-empty svg {
  margin-right: 7px;
  vertical-align: middle;
}

.loading-icon {
  animation: license-spin .7s linear infinite;
}

@keyframes license-spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
.license-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1090;
  padding: 0;
  border: 0;
  background: transparent;
}

.license-action-menu {
  width: 190px;
  position: fixed;
  z-index: 1100;
  padding: 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  background: var(--bg-2);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .42);
  opacity: 1;
  transform: scale(1);
  transform-origin: top right;
  transition: opacity 160ms cubic-bezier(.23, 1, .32, 1), transform 160ms cubic-bezier(.23, 1, .32, 1);
}

@starting-style {
  .license-action-menu {
    opacity: 0;
    transform: scale(.96);
  }
}

.license-action-menu button {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  background: transparent;
  text-align: left;
  font-size: 12px;
}

.license-action-menu button:hover:not(:disabled) {
  color: var(--text-1);
  background: var(--surface-2);
}

.license-action-menu button.danger {
  color: #ff9db4;
}

.license-action-menu button:disabled {
  opacity: .38;
}

.license-menu-separator {
  height: 1px;
  margin: 5px 4px;
  background: var(--border-1);
}

@media (prefers-reduced-motion: reduce) {
  .license-action-menu {
    transform: none;
    transition-property: opacity;
  }

  .loading-icon {
    animation-duration: 1.2s;
  }
}
</style>
