<script setup lang="ts">
import { ClipboardCopy, KeyRound, RefreshCw, Save, ShieldOff, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { lookupLicense, selfReplaceLicense, selfRevokeLicense, type LicenseLookupResult } from '../api';
import { formatDateTime, planLabel, statusLabel } from '../utils/format';

interface StoredLicenseEntry {
  code: string;
  label: string;
  savedAt: string;
  source: 'query' | 'replace' | 'manual' | 'revoke';
  plan?: string;
  status?: string;
  expiresAt?: string;
}

const LICENSE_HISTORY_KEY = 'pubflow:web:license-history';
const MAX_STORED_LICENSES = 12;

const activationCode = ref('');
const reason = ref('');
const lookupResult = ref<LicenseLookupResult>();
const message = ref('');
const errorMessage = ref('');
const loading = ref(false);
const newActivationCode = ref('');
const savedLicenses = ref<StoredLicenseEntry[]>([]);
const maskedCode = computed(() => maskCode(activationCode.value));
const hasSavedLicenses = computed(() => savedLicenses.value.length > 0);

onMounted(() => {
  savedLicenses.value = readStoredLicenses();
});

async function lookup() {
  const code = normalizedCode();
  if (!code) return setError('请输入激活码');
  loading.value = true;
  clearMessages();
  try {
    lookupResult.value = await lookupLicense(code);
    saveLicenseToBrowser(code, 'query', lookupResult.value);
  } catch (error) {
    setError(error instanceof Error ? error.message : '查询失败');
  } finally {
    loading.value = false;
  }
}

async function replaceCode() {
  const code = normalizedCode();
  if (!code) return setError('请输入激活码');
  loading.value = true;
  clearMessages();
  try {
    const generatedCode = await selfReplaceLicense(code, reason.value.trim() || undefined);
    const result = await lookupLicense(generatedCode).catch(() => undefined);
    activationCode.value = generatedCode;
    newActivationCode.value = generatedCode;
    lookupResult.value = result;
    saveLicenseToBrowser(code, 'revoke', undefined, '已注销旧卡密');
    saveLicenseToBrowser(generatedCode, 'replace', result, '补发新卡密');
    message.value = '新激活码已生成，旧激活码已注销。';
  } catch (error) {
    setError(error instanceof Error ? error.message : '补发失败');
  } finally {
    loading.value = false;
  }
}

async function revokeCode() {
  const code = normalizedCode();
  if (!code) return setError('请输入激活码');
  if (!window.confirm('确认注销这个激活码？注销后关联授权会立即失效。')) return;
  loading.value = true;
  clearMessages();
  try {
    await selfRevokeLicense(code, reason.value.trim() || undefined);
    message.value = '激活码已注销。';
    lookupResult.value = await lookupLicense(code).catch(() => undefined);
    saveLicenseToBrowser(code, 'revoke', lookupResult.value, '已注销卡密');
  } catch (error) {
    setError(error instanceof Error ? error.message : '注销失败');
  } finally {
    loading.value = false;
  }
}

async function copyNewCode() {
  if (!newActivationCode.value) return;
  await copyCode(newActivationCode.value);
  message.value = '新激活码已复制。';
}

async function copyCode(code: string) {
  await navigator.clipboard.writeText(code);
  message.value = '激活码已复制。';
  errorMessage.value = '';
}

function importCurrentCode() {
  const code = normalizedCode();
  if (!code) return setError('请输入要保存到本机的激活码');
  saveLicenseToBrowser(code, 'manual', lookupResult.value, '手动保存');
  message.value = '已保存到当前浏览器。';
}

function useSavedLicense(entry: StoredLicenseEntry) {
  activationCode.value = entry.code;
  lookupResult.value = undefined;
  newActivationCode.value = '';
  message.value = '已填入本机保存的激活码。';
  errorMessage.value = '';
}

function removeSavedLicense(code: string) {
  savedLicenses.value = savedLicenses.value.filter((item) => item.code !== code);
  persistStoredLicenses();
}

function clearSavedLicenses() {
  savedLicenses.value = [];
  persistStoredLicenses();
  message.value = '本机保存的卡密已清空。';
}

function normalizedCode() {
  return activationCode.value.trim().toUpperCase();
}

function clearMessages() {
  message.value = '';
  errorMessage.value = '';
  newActivationCode.value = '';
}

function setError(value: string) {
  errorMessage.value = value;
  message.value = '';
}

function maskCode(value: string) {
  const code = value.trim().toUpperCase();
  if (code.length <= 10) return code;
  return `${code.slice(0, 6)}••••${code.slice(-4)}`;
}

function saveLicenseToBrowser(
  code: string,
  source: StoredLicenseEntry['source'],
  result?: LicenseLookupResult,
  label?: string,
) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  const entry: StoredLicenseEntry = {
    code: normalized,
    label: label || (source === 'replace' ? '补发新卡密' : '最近查询'),
    savedAt: new Date().toISOString(),
    source,
    plan: result?.plan,
    status: result?.status,
    expiresAt: result?.expiresAt,
  };
  savedLicenses.value = [
    entry,
    ...savedLicenses.value.filter((item) => item.code !== normalized),
  ].slice(0, MAX_STORED_LICENSES);
  persistStoredLicenses();
}

function readStoredLicenses(): StoredLicenseEntry[] {
  try {
    const raw = localStorage.getItem(LICENSE_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is StoredLicenseEntry => typeof item?.code === 'string')
          .map((item) => ({
            code: item.code.trim().toUpperCase(),
            label: typeof item.label === 'string' ? item.label : '本机保存',
            savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
            source: ['query', 'replace', 'manual', 'revoke'].includes(item.source) ? item.source : 'manual',
            plan: typeof item.plan === 'string' ? item.plan : undefined,
            status: typeof item.status === 'string' ? item.status : undefined,
            expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : undefined,
          }))
          .slice(0, MAX_STORED_LICENSES)
      : [];
  } catch {
    return [];
  }
}

function persistStoredLicenses() {
  localStorage.setItem(LICENSE_HISTORY_KEY, JSON.stringify(savedLicenses.value));
}

function savedMeta(entry: StoredLicenseEntry) {
  const parts = [
    entry.plan ? planLabel(entry.plan) : '',
    entry.status ? statusLabel(entry.status) : '',
    entry.expiresAt ? `到期 ${formatDateTime(entry.expiresAt)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : entry.label;
}

function savedTime(value: string) {
  return formatDateTime(value);
}
</script>

<template>
  <main class="license-service-page">
    <section class="purchase-hero">
      <p class="eyebrow">License Center</p>
      <h1>卡密自助服务</h1>
      <p>查询授权状态，或在卡密泄露、换机失败时补发新卡密并注销旧卡密。</p>
    </section>

    <section class="license-service-layout">
      <div class="license-service-panel">
        <label>
          <span>激活码</span>
          <input v-model="activationCode" placeholder="PF-XXXXXXXXXXXXXXXX" autocomplete="off" spellcheck="false" @keydown.enter="lookup" />
        </label>
        <label>
          <span>原因</span>
          <input v-model="reason" placeholder="例如换浏览器、旧卡密泄露、重装后无法激活" />
        </label>
        <div class="license-service-actions">
          <button class="secondary-button compact" type="button" :disabled="loading" @click="lookup">
            <RefreshCw :size="16" />
            查询
          </button>
          <button class="primary-button compact" type="button" :disabled="loading" @click="replaceCode">
            <KeyRound :size="16" />
            补发新卡密
          </button>
          <button class="secondary-button compact danger-action" type="button" :disabled="loading" @click="revokeCode">
            <ShieldOff :size="16" />
            注销旧卡密
          </button>
        </div>
        <p v-if="message" class="generate-result">{{ message }}</p>
        <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>

        <div class="saved-license-box">
          <div class="saved-license-head">
            <div>
              <span>本机保存的卡密</span>
              <strong>当前浏览器可恢复</strong>
            </div>
            <div class="saved-license-actions">
              <button type="button" class="icon-button" title="保存当前输入" aria-label="保存当前输入" @click="importCurrentCode">
                <Save :size="16" />
              </button>
              <button v-if="hasSavedLicenses" type="button" class="icon-button" title="清空本机卡密" aria-label="清空本机卡密" @click="clearSavedLicenses">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
          <div v-if="hasSavedLicenses" class="saved-license-list">
            <div v-for="entry in savedLicenses" :key="entry.code" class="saved-license-row">
              <button type="button" class="saved-license-main" @click="useSavedLicense(entry)">
                <b>{{ maskCode(entry.code) }}</b>
                <span>{{ savedMeta(entry) }}</span>
                <small>{{ savedTime(entry.savedAt) }}</small>
              </button>
              <div class="saved-license-tools">
                <button type="button" class="icon-button" title="复制卡密" aria-label="复制卡密" @click="copyCode(entry.code)">
                  <ClipboardCopy :size="15" />
                </button>
                <button type="button" class="icon-button" title="移除记录" aria-label="移除记录" @click="removeSavedLicense(entry.code)">
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
          </div>
          <p v-else>查询、补发或点击保存后，卡密会留在当前浏览器。</p>
        </div>
      </div>

      <aside class="license-service-result">
        <template v-if="lookupResult">
          <span>当前卡密</span>
          <strong>{{ maskedCode }}</strong>
          <div class="summary-line"><span>套餐</span><b>{{ planLabel(lookupResult.plan) }}</b></div>
          <div class="summary-line"><span>状态</span><b>{{ statusLabel(lookupResult.status) }}</b></div>
          <div class="summary-line"><span>安装实例</span><b>{{ lookupResult.activeInstallCount }}/{{ lookupResult.maxDevices }}</b></div>
          <div class="summary-line"><span>迁移次数</span><b>{{ lookupResult.deviceMigrationCount }}/{{ lookupResult.deviceMigrationLimit }}</b></div>
          <div class="summary-line"><span>激活时间</span><b>{{ lookupResult.activatedAt ? formatDateTime(lookupResult.activatedAt) : '未激活' }}</b></div>
          <div class="summary-line"><span>到期时间</span><b>{{ lookupResult.expiresAt ? formatDateTime(lookupResult.expiresAt) : '未激活' }}</b></div>
        </template>
        <template v-else>
          <span>卡密状态</span>
          <strong>等待查询</strong>
          <p>输入激活码后可查看有效期、安装实例占用和迁移次数。</p>
        </template>
        <div v-if="newActivationCode" class="activation-code-display">
          <label>新激活码</label>
          <div class="code-row">
            <code>{{ newActivationCode }}</code>
            <button type="button" class="icon-button" title="复制新激活码" aria-label="复制新激活码" @click="copyNewCode">
              <ClipboardCopy :size="16" />
            </button>
          </div>
        </div>
      </aside>
    </section>
  </main>
</template>
