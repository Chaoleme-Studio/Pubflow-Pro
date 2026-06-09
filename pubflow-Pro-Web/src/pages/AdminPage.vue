<script setup lang="ts">
import {
  Activity,
  CheckCircle2,
  DatabaseZap,
  Download,
  KeyRound,
  Layers3,
  ListChecks,
  LogIn,
  LogOut,
  RadioTower,
  RefreshCw,
  Search,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  adminLogin,
  generateLicenses,
  getDauStats,
  getSelectorVersion,
  listAdminLeases,
  listAdminLicenses,
  listAdminOrders,
  uploadSelector,
  type AdminLeaseItem,
  type AdminLicenseItem,
  type AdminOrderItem,
  type DauStat,
  type LicenseSummary,
  type SelectorVersionItem,
} from '../api';
import AdminOverviewChart from '../components/admin/AdminOverviewChart.vue';
import { eventLabel, formatDateTime, inDateRange, planLabel, shortHash, sourceLabel, statusLabel, toDateOnly, yuan } from '../utils/format';

type AdminView = 'overview' | 'users' | 'licenses' | 'leases' | 'selectors';

const adminView = ref<AdminView>('overview');
const adminToken = ref(sessionStorage.getItem('pubflow_admin_token') || '');
const adminLoggedIn = ref(Boolean(adminToken.value));
const adminAccount = ref('');
const adminPassword = ref('');
const adminLoginError = ref('');
const adminLoginAttempts = ref(Number(localStorage.getItem('pubflow_admin_login_attempts') || 0));
const adminLockedUntil = ref(Number(localStorage.getItem('pubflow_admin_locked_until') || 0));
const showPasswordHelp = ref(false);
const adminDataError = ref('');
const adminLoading = ref(false);
const orderPage = ref(1);
const orderPageSize = ref(10);
const selectedLicense = ref('');
const remoteOrders = ref<AdminOrderItem[]>([]);
const remoteLicenses = ref<AdminLicenseItem[]>([]);
const remoteLeases = ref<AdminLeaseItem[]>([]);
const dauStats = ref<DauStat[]>([]);
const selectorVersion = ref<SelectorVersionItem>();

// License 分页和统计
const licensePage = ref(1);
const licensePageSize = ref(20);
const licenseTotal = ref(0);
const licenseSummaryData = ref<LicenseSummary>({ total: 0, pending: 0, active: 0, revenueCents: 0 });

// 授权记录筛选
const leaseDateFrom = ref('');
const leaseDateTo = ref('');
const dauDateFrom = ref('');
const dauDateTo = ref('');
const leasePage = ref(1);
const leasePageSize = ref(20);

// 时间筛选快捷选项
type TimeRange = 'week' | 'month' | 'custom';
const overviewTimeRange = ref<TimeRange>('week');
const leaseTimeRange = ref<TimeRange>('week');
const selectorUploadVersion = ref(1);
const selectorUploadMinVersion = ref('0.1.0');
const selectorUploadJson = ref(JSON.stringify({
  douyin: {
    title_input: '#title-input',
    desc_input: '#desc-input',
    publish_btn: '#publish-btn',
    video_upload: '#video-upload',
    cover_upload: '#cover-upload',
  },
}, null, 2));
const selectorUploadMessage = ref('');

// 生成激活码相关
const generatePlan = ref<'monthly' | 'yearly'>('monthly');
const generateQuantity = ref(10);
const generateMaxDevices = ref(1);
const generateBatchName = ref('');
const generateSalesChannel = ref('third_party');
const generateLoading = ref(false);
const generateResult = ref('');
const showGenerateDialog = ref(false);
const modalContentRef = ref<HTMLDivElement>();
const licenseViewMode = ref<'card' | 'table'>('card');

watch(showGenerateDialog, (open) => {
  if (open) nextTick(() => modalContentRef.value?.focus());
});

const emptyFilters = () => ({
  keyword: '',
  plan: 'all',
  status: 'all',
  paidFrom: '',
  paidTo: '',
  expiresFrom: '',
  expiresTo: '',
});
const orderFilters = ref(emptyFilters());
const licenseFilters = ref(emptyFilters());

const adminTabs = [
  { key: 'overview', label: '总览', icon: Activity },
  { key: 'users', label: '订单', icon: WalletCards },
  { key: 'licenses', label: '卡密生成', icon: KeyRound },
  { key: 'leases', label: '授权记录', icon: ListChecks },
  { key: 'selectors', label: 'Selector 状态', icon: DatabaseZap },
] as const;

const normalizedOrders = computed(() => {
  return remoteOrders.value.map((item) => ({
    id: item.id,
    orderNo: item.orderNo,
    plan: item.plan || 'monthly',
    status: item.status,
    source: item.channel || '-',
    activationCode: item.activationCode || '-',
    paidAt: toDateOnly(item.paidAt),
    expiresAt: item.expiresAt ? toDateOnly(item.expiresAt) : '未激活',
    createdAt: formatDateTime(item.createdAt),
    updatedAt: formatDateTime(item.updatedAt),
    amountCents: item.amountCents || 0,
  }));
});

const normalizedLicenses = computed(() => {
  return remoteLicenses.value.map((item) => ({
    id: item.id,
    code: item.activationCode,
    user: item.userId ? `用户 #${item.userId}` : '未激活',
    plan: item.plan,
    maxDevices: item.maxDevices,
    paidAt: toDateOnly(item.paidAt),
    createdAt: toDateOnly(item.createdAt),
    expiresAt: item.expiresAt ? toDateOnly(item.expiresAt) : '未激活',
    activatedAt: item.activatedAt ? formatDateTime(item.activatedAt) : '-',
    status: item.status || (item.isRevoked ? 'revoked' : item.activatedAt ? 'active' : 'pending'),
    orderNo: item.orderNo || '-',
    channel: item.orderChannel || '-',
    sourceChannel: item.sourceChannel || '-',
    batchName: item.batchName || '-',
    amountCents: item.amountCents || 0,
  }));
});

const filteredOrders = computed(() => {
  return normalizedOrders.value.filter((item) => {
    const keyword = orderFilters.value.keyword.trim().toLowerCase();
    const inKeyword = !keyword || `${item.orderNo} ${item.source} ${item.status} ${item.activationCode}`.toLowerCase().includes(keyword);
    const inPlan = orderFilters.value.plan === 'all' || item.plan === orderFilters.value.plan;
    const inStatus = orderFilters.value.status === 'all' || item.status === orderFilters.value.status;
    const inPaidRange = inDateRange(item.paidAt, orderFilters.value.paidFrom, orderFilters.value.paidTo);
    const inExpireRange = item.expiresAt === '未激活'
      ? !(orderFilters.value.expiresFrom || orderFilters.value.expiresTo)
      : inDateRange(item.expiresAt, orderFilters.value.expiresFrom, orderFilters.value.expiresTo);
    return inKeyword && inPlan && inStatus && inPaidRange && inExpireRange;
  });
});

const filteredLicenses = computed(() => {
  return normalizedLicenses.value.filter((item) => {
    const keyword = licenseFilters.value.keyword.trim().toLowerCase();
    const inKeyword = !keyword || `${item.code} ${item.user} ${item.plan} ${item.status} ${item.orderNo}`.toLowerCase().includes(keyword);
    const inPlan = licenseFilters.value.plan === 'all' || item.plan === licenseFilters.value.plan;
    const inStatus = licenseFilters.value.status === 'all' || item.status === licenseFilters.value.status;
    const inPaidRange = inDateRange(item.paidAt, licenseFilters.value.paidFrom, licenseFilters.value.paidTo);
    const inExpireRange = item.expiresAt === '未激活'
      ? !(licenseFilters.value.expiresFrom || licenseFilters.value.expiresTo)
      : inDateRange(item.expiresAt, licenseFilters.value.expiresFrom, licenseFilters.value.expiresTo);
    return inKeyword && inPlan && inStatus && inPaidRange && inExpireRange;
  });
});

const orderSummary = computed(() => ({
  total: filteredOrders.value.length,
  yearly: filteredOrders.value.filter((item) => item.plan === 'yearly').length,
  monthly: filteredOrders.value.filter((item) => item.plan === 'monthly').length,
  revenue: filteredOrders.value.reduce((sum, item) => sum + item.amountCents, 0),
}));
const licenseSummary = computed(() => ({
  total: licenseSummaryData.value.total,
  pending: licenseSummaryData.value.pending,
  active: licenseSummaryData.value.active,
  revenue: licenseSummaryData.value.revenueCents,
}));
const dauMax = computed(() => {
  const vals = dauStats.value.flatMap(d => [d.activations, d.verifications]);
  return Math.max(1, ...vals);
});
const dauYTicks = computed(() => {
  const m = dauMax.value;
  const step = m <= 5 ? 1 : m <= 20 ? 5 : Math.ceil(m / 4 / 5) * 5;
  const ticks = [];
  for (let v = 0; v <= m; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < m) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
});
const orderTotalPages = computed(() => Math.max(1, Math.ceil(filteredOrders.value.length / orderPageSize.value)));
const paginatedOrders = computed(() => {
  const safePage = Math.min(orderPage.value, orderTotalPages.value);
  const start = (safePage - 1) * orderPageSize.value;
  return filteredOrders.value.slice(start, start + orderPageSize.value);
});
const licenseTotalPages = computed(() => Math.max(1, Math.ceil(licenseTotal.value / licensePageSize.value)));
const leaseTotalPages = computed(() => Math.max(1, Math.ceil(remoteLeases.value.length / leasePageSize.value)));
const paginatedLeases = computed(() => {
  const safePage = Math.min(leasePage.value, leaseTotalPages.value);
  const start = (safePage - 1) * leasePageSize.value;
  return remoteLeases.value.slice(start, start + leasePageSize.value);
});
const loginLockedSeconds = computed(() => Math.max(0, Math.ceil((adminLockedUntil.value - Date.now()) / 1000)));
const paidToday = computed(() => remoteOrders.value.filter((item) => toDateOnly(item.paidAt) === new Date().toISOString().slice(0, 10)));
const leaseSuccessCount = computed(() => remoteLeases.value.filter((l) => l.status === 'success').length);
const leaseFailedCount = computed(() => remoteLeases.value.filter((l) => l.status === 'failed').length);
const adminStats = computed(() => [
  { label: '订单总数', value: String(remoteOrders.value.length), delta: `${orderSummary.value.yearly} 年卡 / ${orderSummary.value.monthly} 月卡`, icon: UsersRound, tone: 'cyan' },
  { label: '今日支付', value: yuan(paidToday.value.reduce((sum, item) => sum + (item.amountCents || 0), 0)), delta: `${paidToday.value.length} 笔订单`, icon: WalletCards, tone: 'green' },
  { label: '待支付授权', value: String(licenseSummary.value.pending), delta: '等待微信/支付宝回调', icon: KeyRound, tone: 'amber' },
  { label: '已激活授权', value: String(licenseSummary.value.active), delta: `${licenseSummary.value.total} 总授权`, icon: CheckCircle2, tone: 'green' },
]);

async function loginAdmin() {
  adminLoginError.value = '';
  if (Date.now() < adminLockedUntil.value) {
    adminLoginError.value = `登录失败过多，请 ${loginLockedSeconds.value} 秒后再试`;
    return;
  }
  try {
    const result = await adminLogin(adminAccount.value.trim(), adminPassword.value);
    adminToken.value = result.token;
    sessionStorage.setItem('pubflow_admin_token', result.token);
    adminLoginAttempts.value = 0;
    localStorage.removeItem('pubflow_admin_login_attempts');
    localStorage.removeItem('pubflow_admin_locked_until');
    adminLoggedIn.value = true;
    void refreshAdminData();
  } catch {
    recordLoginFailure();
    adminLoginError.value ||= '用户名或密码错误';
  }
}

function recordLoginFailure() {
  adminLoginAttempts.value += 1;
  localStorage.setItem('pubflow_admin_login_attempts', String(adminLoginAttempts.value));
  if (adminLoginAttempts.value >= 5) {
    adminLockedUntil.value = Date.now() + 5 * 60 * 1000;
    localStorage.setItem('pubflow_admin_locked_until', String(adminLockedUntil.value));
    adminLoginError.value = '连续失败 5 次，已限制登录 5 分钟';
    return;
  }
  adminLoginError.value = `账号或密码错误，还可尝试 ${5 - adminLoginAttempts.value} 次`;
}

function logoutAdmin() {
  adminLoggedIn.value = false;
  adminToken.value = '';
  sessionStorage.removeItem('pubflow_admin_token');
}

async function handleGenerateLicenses() {
  if (!adminToken.value) return;
  generateLoading.value = true;
  generateResult.value = '';
  try {
    const result = await generateLicenses(adminToken.value, {
      plan: generatePlan.value,
      quantity: generateQuantity.value,
      maxDevices: generateMaxDevices.value,
      batchName: generateBatchName.value.trim() || undefined,
      salesChannel: generateSalesChannel.value.trim() || undefined,
    });
    generateResult.value = `成功生成 ${result.items.length} 个激活码`;
    showGenerateDialog.value = false;
    // 刷新列表
    await refreshAdminData();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '生成失败';
  } finally {
    generateLoading.value = false;
  }
}

async function refreshAdminData() {
  if (!adminToken.value) return;
  adminLoading.value = true;
  adminDataError.value = '';
  try {
    // 应用默认时间筛选
    applyOverviewTimeRange();
    applyLeaseTimeRange();

    const [users, licenseResult, selector] = await Promise.all([
      listAdminOrders(adminToken.value, orderFilters.value),
      listAdminLicenses(adminToken.value, { ...licenseFilters.value, page: licensePage.value, pageSize: licensePageSize.value }),
      getSelectorVersion(adminToken.value),
      refreshLeases(),
      refreshDauStats(),
    ]);
    remoteOrders.value = users;
    remoteLicenses.value = licenseResult.items;
    licenseTotal.value = licenseResult.total;
    licenseSummaryData.value = licenseResult.summary;
    selectorVersion.value = selector;
  } catch (error) {
    adminDataError.value = error instanceof Error ? error.message : '后台数据加载失败，请确认服务端已启动';
  } finally {
    adminLoading.value = false;
  }
}

async function refreshLeases() {
  if (!adminToken.value) return;
  try {
    remoteLeases.value = await listAdminLeases(adminToken.value, leaseDateFrom.value || undefined, leaseDateTo.value || undefined);
  } catch (e) {
    console.warn('加载授权记录失败:', e);
  }
}

async function refreshDauStats() {
  if (!adminToken.value) return;
  try {
    dauStats.value = await getDauStats(adminToken.value, dauDateFrom.value || undefined, dauDateTo.value || undefined);
  } catch (e) {
    console.warn('加载 DAU 统计失败:', e);
  }
}

function getDateRange(range: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: string;
  if (range === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    from = d.toISOString().slice(0, 10);
  } else if (range === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    from = d.toISOString().slice(0, 10);
  } else {
    from = '';
  }
  return { from, to };
}

function applyOverviewTimeRange() {
  const { from, to } = getDateRange(overviewTimeRange.value);
  dauDateFrom.value = from;
  dauDateTo.value = to;
}

function applyLeaseTimeRange() {
  const { from, to } = getDateRange(leaseTimeRange.value);
  leaseDateFrom.value = from;
  leaseDateTo.value = to;
}

function resetOrderFilters() {
  orderFilters.value = emptyFilters();
  orderPage.value = 1;
  void refreshAdminData();
}

function resetLicenseFilters() {
  licenseFilters.value = emptyFilters();
  licensePage.value = 1;
  void refreshAdminData();
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportLicenses() {
  if (filteredLicenses.value.length === 0) return;
  const header = '激活码,套餐,状态,用户,授权到期,订单号,来源渠道,批次\n';
  const rows = filteredLicenses.value.map((item) =>
    [item.code, planLabel(item.plan), statusLabel(item.status), item.user, item.expiresAt, item.orderNo, sourceLabel(item.sourceChannel), item.batchName].map(csvEscape).join(',')
  ).join('\n');
  const bom = '﻿';
  const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pubflow-licenses-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function submitSelectorUpload() {
  selectorUploadMessage.value = '';
  try {
    const selectors = JSON.parse(selectorUploadJson.value);
    await uploadSelector(adminToken.value, {
      version: selectorUploadVersion.value,
      minAppVersion: selectorUploadMinVersion.value,
      selectors,
    });
    selectorUploadMessage.value = 'Selector 已上传并切换为当前版本';
    selectorVersion.value = await getSelectorVersion(adminToken.value);
  } catch (error) {
    selectorUploadMessage.value = error instanceof Error ? error.message : 'Selector 上传失败';
  }
}

if (adminLoggedIn.value) {
  void refreshAdminData();
}
</script>

<template>
  <main v-if="!adminLoggedIn" class="admin-login-page">
    <section class="login-visual">
      <div class="login-orbit">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p class="eyebrow">Private Console</p>
      <h1>PubFlow 管理后台</h1>
      <p>后台只给运营和管理员使用，用户购买、下载和授权操作都在用户侧页面完成。</p>
    </section>
    <section class="login-panel">
      <div class="login-panel-head">
        <img class="panel-brand-icon" src="/icon.svg" alt="" aria-hidden="true" />
        <div>
          <span>管理员登录</span>
          <strong>账号密码访问</strong>
        </div>
      </div>
      <label>
        <span>账号</span>
        <input v-model="adminAccount" autocomplete="username" placeholder="admin" />
      </label>
      <label>
        <span>密码</span>
        <input v-model="adminPassword" autocomplete="current-password" type="password" placeholder="输入后台密码" @keydown.enter="loginAdmin" />
      </label>
      <p v-if="adminLoginError" class="login-error">{{ adminLoginError }}</p>
      <button class="forgot-button" type="button" @click="showPasswordHelp = !showPasswordHelp">忘记密码怎么办？</button>
      <p v-if="showPasswordHelp" class="password-help">请在服务端 `.env` 文件中配置 ADMIN_USERNAME 和 ADMIN_PASSWORD，然后重启服务。</p>
      <button class="primary-button login-button" type="button" @click="loginAdmin">
        <LogIn :size="18" />
        登录后台
      </button>
    </section>
  </main>

  <main v-else class="admin-page">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <img src="/icon.svg" alt="" aria-hidden="true" />
        PubFlow Ops
      </div>
      <button v-for="item in adminTabs" :key="item.key" type="button" :class="{ active: adminView === item.key }" @click="adminView = item.key">
        <component :is="item.icon" :size="18" />
        {{ item.label }}
      </button>
      <button class="sidebar-logout" type="button" @click="logoutAdmin">
        <LogOut :size="18" />
        退出登录
      </button>
    </aside>

    <section class="admin-workspace">
      <header class="admin-topbar">
        <div>
          <span>运营后台</span>
          <h1>{{ adminView === 'overview' ? '业务驾驶舱' : adminView === 'licenses' ? '卡密生成' : adminView === 'users' ? '订单运营' : adminView === 'leases' ? '授权记录' : 'Selector 状态' }}</h1>
        </div>
        <div class="admin-actions">
          <button class="secondary-button compact" type="button" @click="refreshAdminData">
            <RefreshCw :size="16" />
            {{ adminLoading ? '同步中' : '同步' }}
          </button>
          <button class="primary-button compact" type="button" @click="adminView = 'licenses'">生成 License</button>
        </div>
      </header>
      <p v-if="adminDataError" class="admin-data-error">{{ adminDataError }}</p>

      <section v-if="adminView === 'overview'" class="admin-overview">
        <div class="stat-grid">
          <article v-for="item in adminStats" :key="item.label" class="stat-tile" :class="`stat-${item.tone}`">
            <component :is="item.icon" :size="22" />
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.delta }}</small>
          </article>
        </div>
        <div class="ops-board">
          <div class="release-line">
            <RadioTower :size="26" />
            <div>
              <strong>运营态势</strong>
            <span>支付成功后签发未激活卡密；有效期从插件首次激活开始计算。</span>
            </div>
          </div>
          <div class="time-filter-bar">
            <button v-for="r in (['week', 'month', 'custom'] as const)" :key="r" type="button" :class="{ active: overviewTimeRange === r }" @click="overviewTimeRange = r; applyOverviewTimeRange(); refreshDauStats()">
              {{ r === 'week' ? '近7天' : r === 'month' ? '近30天' : '自定义' }}
            </button>
            <template v-if="overviewTimeRange === 'custom'">
              <input v-model="dauDateFrom" type="date" @change="refreshDauStats()" />
              <span>至</span>
              <input v-model="dauDateTo" type="date" @change="refreshDauStats()" />
            </template>
          </div>
          <AdminOverviewChart :orders="remoteOrders" :licenses="remoteLicenses" />
          <div class="dau-chart-section">
            <strong>活跃用户趋势</strong>
            <div class="dau-chart-wrapper">
              <div class="dau-y-axis">
                <span v-for="tick in dauYTicks" :key="tick" :style="{ bottom: `${(tick / dauYTicks[dauYTicks.length - 1]) * 100}%` }">{{ tick }}</span>
              </div>
              <div class="dau-chart">
                <div v-for="day in dauStats" :key="day.date" class="dau-bar-group">
                  <div class="dau-bar-stack">
                    <div class="dau-bar activations" :style="{ height: `${Math.max(4, (day.activations / dauYTicks[dauYTicks.length - 1]) * 150)}px` }" :title="`激活: ${day.activations}`"></div>
                    <div class="dau-bar verifications" :style="{ height: `${Math.max(4, (day.verifications / dauYTicks[dauYTicks.length - 1]) * 150)}px` }" :title="`验证: ${day.verifications}`"></div>
                  </div>
                  <span class="dau-label">{{ day.date.slice(5) }}</span>
                </div>
              </div>
            </div>
            <div class="dau-legend">
              <span><i class="legend-dot activations"></i> 激活数</span>
              <span><i class="legend-dot verifications"></i> 活跃设备数</span>
            </div>
          </div>
        </div>
        <div class="review-lane">
          <div>
            <span>待激活卡密</span>
            <strong>{{ licenseSummary.pending }} 个卡密尚未被插件激活</strong>
            <button class="mini-action" type="button" @click="adminView = 'licenses'">查看授权</button>
          </div>
          <div>
            <span>已激活</span>
            <strong>{{ licenseSummary.active }} 个授权已被用户激活</strong>
            <button class="mini-action" type="button" @click="adminView = 'licenses'">查看授权</button>
          </div>
          <div>
            <span>版本治理</span>
            <strong>{{ selectorVersion ? `Selector v${selectorVersion.version}` : '暂无 Selector 版本' }}</strong>
            <button class="mini-action" type="button" @click="adminView = 'selectors'">进入版本库</button>
          </div>
        </div>
      </section>

      <section v-else-if="adminView === 'users'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>订单运营</span>
            <strong>订单、支付和授权状态集中查询</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ orderSummary.total }}</b>筛选结果</span>
            <span><b>{{ orderSummary.yearly }}</b>年卡</span>
            <span><b>{{ orderSummary.monthly }}</b>月卡</span>
            <span><b>{{ yuan(orderSummary.revenue) }}</b>收入</span>
          </div>
        </div>
        <div class="advanced-filters">
          <label class="filter-wide">
            <span>模糊搜索</span>
            <div class="filter-input">
              <Search :size="16" />
              <input v-model="orderFilters.keyword" placeholder="订单号、支付渠道、状态、授权码" />
            </div>
          </label>
          <label>
            <span>套餐类型</span>
            <select v-model="orderFilters.plan">
              <option value="all">全部套餐</option>
              <option value="monthly">月卡</option>
              <option value="yearly">年卡</option>
            </select>
          </label>
          <label>
            <span>订单状态</span>
            <select v-model="orderFilters.status">
              <option value="all">全部状态</option>
              <option value="pending">待支付</option>
              <option value="paid">已支付</option>
              <option value="amount_mismatch">金额异常</option>
            </select>
          </label>
          <label><span>购买开始</span><input v-model="orderFilters.paidFrom" type="date" /></label>
          <label><span>购买结束</span><input v-model="orderFilters.paidTo" type="date" /></label>
          <label><span>授权到期开始</span><input v-model="orderFilters.expiresFrom" type="date" /></label>
          <label><span>授权到期结束</span><input v-model="orderFilters.expiresTo" type="date" /></label>
          <div class="filter-actions">
            <button class="secondary-button compact" type="button" @click="resetOrderFilters">重置</button>
            <button class="primary-button compact" type="button" @click="refreshAdminData">查询</button>
          </div>
        </div>
        <table>
          <thead><tr><th>订单号</th><th>套餐</th><th>支付渠道</th><th>支付时间</th><th>授权到期</th><th>授权码</th><th>状态</th><th>金额</th></tr></thead>
          <tbody>
            <tr v-if="paginatedOrders.length === 0"><td colspan="8" class="table-empty">暂无匹配订单，请检查筛选条件或数据库初始化数据。</td></tr>
            <tr v-for="item in paginatedOrders" :key="item.id">
              <td><strong>{{ item.orderNo }}</strong></td>
              <td>{{ planLabel(item.plan) }}</td>
              <td>{{ sourceLabel(item.source) }}</td>
              <td>{{ item.paidAt || '-' }}</td>
              <td>{{ item.expiresAt || '-' }}</td>
              <td><code class="hash-code">{{ shortHash(item.activationCode) }}</code></td>
              <td><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></td>
              <td>{{ yuan(item.amountCents) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pagination-bar">
          <span>共 {{ filteredOrders.length }} 条，第 {{ Math.min(orderPage, orderTotalPages) }} / {{ orderTotalPages }} 页</span>
          <div>
            <label class="page-size-select">
              每页
              <select v-model.number="orderPageSize" @change="orderPage = 1">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </label>
            <button type="button" :disabled="orderPage <= 1" @click="orderPage -= 1">上一页</button>
            <button type="button" :disabled="orderPage >= orderTotalPages" @click="orderPage += 1">下一页</button>
          </div>
        </div>
      </section>

      <section v-else-if="adminView === 'licenses'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>卡密管理</span>
            <strong>给三方平台补货的激活码；未激活前没有到期时间</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ licenseSummary.total }}</b>总计</span>
            <span><b>{{ licenseSummary.pending }}</b>待激活</span>
            <span><b>{{ licenseSummary.active }}</b>已激活</span>
            <span><b>{{ yuan(licenseSummary.revenue) }}</b>收入</span>
          </div>
          <div class="admin-actions">
            <button class="secondary-button compact" type="button" :class="{ active: licenseViewMode === 'card' }" @click="licenseViewMode = 'card'">卡片</button>
            <button class="secondary-button compact" type="button" :class="{ active: licenseViewMode === 'table' }" @click="licenseViewMode = 'table'">表格</button>
            <button class="secondary-button compact" type="button" @click="exportLicenses">
              <Download :size="14" />
              导出 CSV
            </button>
            <button class="primary-button compact" type="button" @click="showGenerateDialog = true">批量生成激活码</button>
          </div>
        </div>
        <p v-if="generateResult" class="generate-result">{{ generateResult }}</p>
        <div class="advanced-filters">
          <label class="filter-wide">
            <span>模糊搜索</span>
            <div class="filter-input">
              <Search :size="16" />
              <input v-model="licenseFilters.keyword" placeholder="激活码、订单号" />
            </div>
          </label>
          <label>
            <span>套餐类型</span>
            <select v-model="licenseFilters.plan">
              <option value="all">全部套餐</option>
              <option value="monthly">月卡</option>
              <option value="yearly">年卡</option>
            </select>
          </label>
          <label>
            <span>授权状态</span>
            <select v-model="licenseFilters.status">
              <option value="all">全部状态</option>
              <option value="pending">待激活</option>
              <option value="active">已激活</option>
              <option value="revoked">已吊销</option>
            </select>
          </label>
          <label><span>授权到期开始</span><input v-model="licenseFilters.expiresFrom" type="date" /></label>
          <label><span>授权到期结束</span><input v-model="licenseFilters.expiresTo" type="date" /></label>
          <div class="filter-actions">
            <button class="secondary-button compact" type="button" @click="resetLicenseFilters">重置</button>
            <button class="primary-button compact" type="button" @click="refreshAdminData">查询</button>
          </div>
        </div>

        <!-- 卡片视图 -->
        <div v-if="licenseViewMode === 'card'" class="license-grid">
          <div v-for="item in filteredLicenses" :key="item.code" class="license-card" :class="{ selected: selectedLicense === item.code }" tabindex="0" role="button" :aria-label="`激活码 ${item.code}`" @click="selectedLicense = item.code" @keydown.enter="selectedLicense = item.code" @keydown.space.prevent="selectedLicense = item.code">
            <div class="license-card-top">
              <span :class="`status-${item.status}`">{{ statusLabel(item.status) }}</span>
              <strong>{{ planLabel(item.plan) }}</strong>
            </div>
            <code class="license-card-code">{{ item.code }}</code>
            <div class="license-card-meta">
              <span>渠道 {{ sourceLabel(item.sourceChannel) }}</span>
              <span>批次 {{ item.batchName }}</span>
              <span>到期 {{ item.expiresAt }}</span>
              <span>创建 {{ item.createdAt }}</span>
            </div>
          </div>
          <div v-if="filteredLicenses.length === 0" class="list-empty">暂无匹配卡密</div>
        </div>

        <!-- 表格视图 -->
        <table v-else>
          <thead><tr><th>激活码</th><th>套餐</th><th>渠道</th><th>批次</th><th>状态</th><th>授权到期</th><th>创建时间</th><th>订单号</th></tr></thead>
          <tbody>
            <tr v-if="filteredLicenses.length === 0"><td colspan="8" class="table-empty">暂无匹配卡密</td></tr>
            <tr v-for="item in filteredLicenses" :key="item.code" :class="{ selected: selectedLicense === item.code }" tabindex="0" @click="selectedLicense = item.code" @keydown.enter="selectedLicense = item.code">
              <td><code class="hash-code">{{ item.code }}</code></td>
              <td>{{ planLabel(item.plan) }}</td>
              <td>{{ sourceLabel(item.sourceChannel) }}</td>
              <td>{{ item.batchName }}</td>
              <td><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></td>
              <td>{{ item.expiresAt }}</td>
              <td>{{ item.createdAt }}</td>
              <td>{{ item.orderNo }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pagination-bar">
          <span>共 {{ licenseTotal }} 条，第 {{ Math.min(licensePage, licenseTotalPages) }} / {{ licenseTotalPages }} 页</span>
          <div>
            <label class="page-size-select">
              每页
              <select v-model.number="licensePageSize" @change="licensePage = 1; refreshAdminData()">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </label>
            <button type="button" :disabled="licensePage <= 1" @click="licensePage -= 1; refreshAdminData()">上一页</button>
            <button type="button" :disabled="licensePage >= licenseTotalPages" @click="licensePage += 1; refreshAdminData()">下一页</button>
          </div>
        </div>
      </section>

      <section v-else-if="adminView === 'leases'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>授权记录</span>
            <strong>插件启动、激活、校验、续租和 Selector 拉取事件</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ remoteLeases.length }}</b>记录总数</span>
            <span><b>{{ leaseSuccessCount }}</b>成功</span>
            <span><b>{{ leaseFailedCount }}</b>失败</span>
          </div>
        </div>
        <div class="advanced-filters lease-filters">
          <div class="time-filter-bar">
            <button v-for="r in (['week', 'month', 'custom'] as const)" :key="r" type="button" :class="{ active: leaseTimeRange === r }" @click="leaseTimeRange = r; applyLeaseTimeRange(); refreshLeases()">
              {{ r === 'week' ? '近7天' : r === 'month' ? '近30天' : '自定义' }}
            </button>
            <template v-if="leaseTimeRange === 'custom'">
              <input v-model="leaseDateFrom" type="date" @change="refreshLeases()" />
              <span>至</span>
              <input v-model="leaseDateTo" type="date" @change="refreshLeases()" />
            </template>
          </div>
          <button class="secondary-button compact" type="button" @click="refreshLeases">
            <RefreshCw :size="14" />
            刷新
          </button>
        </div>
        <table>
          <thead><tr><th>时间</th><th>激活码</th><th>事件</th><th>结果</th><th>IP 地址</th><th>设备</th><th>平台</th><th>授权到期</th><th>原因</th></tr></thead>
          <tbody>
            <tr v-if="paginatedLeases.length === 0"><td colspan="9" class="table-empty">暂无授权记录。</td></tr>
            <tr v-for="item in paginatedLeases" :key="item.id">
              <td>{{ formatDateTime(item.createdAt) }}</td>
              <td><code class="hash-code">{{ shortHash(item.activationCode) }}</code></td>
              <td>{{ eventLabel(item.eventType) }}</td>
              <td><mark :class="`status-${item.status}`">{{ statusLabel(item.status) }}</mark></td>
              <td><code>{{ item.ipAddress || '-' }}</code></td>
              <td><code class="hash-code">{{ shortHash(item.machineHash) }}</code></td>
              <td>{{ item.platform || '-' }}</td>
              <td>{{ item.expiresAt ? formatDateTime(item.expiresAt) : '-' }}</td>
              <td>{{ item.reason || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pagination-bar">
          <span>共 {{ remoteLeases.length }} 条，第 {{ Math.min(leasePage, leaseTotalPages) }} / {{ leaseTotalPages }} 页</span>
          <div>
            <label class="page-size-select">
              每页
              <select v-model.number="leasePageSize" @change="leasePage = 1">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </label>
            <button type="button" :disabled="leasePage <= 1" @click="leasePage -= 1">上一页</button>
            <button type="button" :disabled="leasePage >= leaseTotalPages" @click="leasePage += 1">下一页</button>
          </div>
        </div>
      </section>

      <section v-else class="selector-vault">
        <div class="selector-status-card">
          <div class="selector-status-head">
            <Layers3 :size="28" />
            <div>
              <strong>Selector 版本状态</strong>
              <p>Selector 告诉 PubFlow 插件在各平台发布时如何定位输入框和按钮（CSS 选择器）。插件启动时自动拉取最新版本。</p>
            </div>
          </div>
          <div v-if="selectorVersion" class="selector-status-detail">
            <div class="selector-status-item">
              <span>当前版本</span>
              <strong>v{{ selectorVersion.version }}</strong>
            </div>
            <div class="selector-status-item">
              <span>最低插件版本</span>
              <strong>{{ selectorVersion.minAppVersion }}</strong>
            </div>
            <div class="selector-status-item">
              <span>发布时间</span>
              <code>{{ formatDateTime(selectorVersion.createdAt) }}</code>
            </div>
            <mark class="selector-status-badge">已生效</mark>
          </div>
          <div v-else class="selector-empty">暂无 Selector 版本，请先上传生产版本。</div>
        </div>

        <div class="selector-upload">
          <strong>上传新版本</strong>
          <div class="selector-form-row">
            <label>
              <span>版本号</span>
              <input v-model.number="selectorUploadVersion" type="number" min="1" />
            </label>
            <label>
              <span>最低插件版本</span>
              <input v-model="selectorUploadMinVersion" />
            </label>
          </div>
          <label>
            <span>Selector JSON</span>
            <textarea v-model="selectorUploadJson"></textarea>
          </label>
          <div class="selector-form-actions">
            <p v-if="selectorUploadMessage" class="selector-upload-message">{{ selectorUploadMessage }}</p>
            <button class="primary-button compact" type="button" @click="submitSelectorUpload">上传版本</button>
          </div>
        </div>
      </section>
    </section>

    <!-- 生成激活码对话框 -->
    <div
      v-if="showGenerateDialog"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="批量生成激活码"
      @click.self="showGenerateDialog = false"
      @keydown.escape="showGenerateDialog = false"
    >
      <div ref="modalContentRef" class="modal-content" tabindex="-1">
        <div class="modal-header">
          <h3>批量生成激活码</h3>
          <button class="icon-button" type="button" aria-label="关闭" @click="showGenerateDialog = false">
            <X :size="20" />
          </button>
        </div>
        <div class="modal-body">
          <label>
            <span>套餐类型</span>
            <select v-model="generatePlan">
              <option value="monthly">月卡</option>
              <option value="yearly">年卡</option>
            </select>
          </label>
          <label>
            <span>生成数量</span>
            <input v-model.number="generateQuantity" type="number" min="1" max="100" />
          </label>
          <label>
            <span>最大设备数</span>
            <input v-model.number="generateMaxDevices" type="number" min="1" max="10" />
          </label>
          <label>
            <span>销售渠道</span>
            <select v-model="generateSalesChannel">
              <option value="third_party">三方平台</option>
              <option value="manual">手动发放</option>
            </select>
          </label>
          <label>
            <span>批次名称</span>
            <input v-model="generateBatchName" placeholder="例如 dy-20260609-100" />
          </label>
          <p class="modal-hint">生成后卡密处于未激活状态，不会产生到期时间；插件首次激活时才开始计时。</p>
        </div>
        <div class="modal-footer">
          <button class="secondary-button compact" type="button" @click="showGenerateDialog = false">取消</button>
          <button class="primary-button compact" type="button" :disabled="generateLoading" @click="handleGenerateLicenses">
            {{ generateLoading ? '生成中...' : '确认生成' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
