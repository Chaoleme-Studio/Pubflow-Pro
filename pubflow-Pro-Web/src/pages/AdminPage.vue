<script setup lang="ts">
import {
  Activity,
  CheckCircle2,
  DatabaseZap,
  Download,
  GitBranch,
  KeyRound,
  LayoutGrid,
  Layers3,
  ListChecks,
  LogIn,
  LogOut,
  PackageOpen,
  RadioTower,
  RefreshCw,
  TableProperties,
  Trash2,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  adminLogin,
  bulkAdminLicenseAction,
  createAdminAppVersion,
  deleteAdminAppVersion,
  deleteAdminLicense,
  freezeAdminLicense,
  generateLicenses,
  getDauStats,
  getAdminProductCatalog,
  getSelectorVersion,
  listAdminAppVersions,
  listAdminLicenseBatches,
  listAdminLeases,
  listAdminLicenses,
  listAdminOrders,
  replaceLicense,
  revokeAdminLicense,
  saveAdminProductCatalog,
  unbindAdminLicenseDevice,
  unfreezeAdminLicense,
  updateAdminAppVersion,
  updateLicenseLimits,
  updateLicenseNote,
  uploadSelector,
  type AdminDownloadConfig,
  type AppVersionItem,
  type AdminLeaseItem,
  type AdminLicenseBatchItem,
  type AdminLicenseItem,
  type AdminOrderItem,
  type AdminPlanConfig,
  type AdminProductCatalogConfig,
  type DauStat,
  type LicenseSummary,
  type LicenseTier,
  type Plan,
  type SelectorVersionItem,
} from '../api';
import AdminOverviewChart from '../components/admin/AdminOverviewChart.vue';
import AdminDialog from '../components/admin/AdminDialog.vue';
import AdminLeaseTable from '../components/admin/AdminLeaseTable.vue';
import AdminLicenseFilters from '../components/admin/AdminLicenseFilters.vue';
import AdminLicenseGrid from '../components/admin/AdminLicenseGrid.vue';
import AdminLicenseTable from '../components/admin/AdminLicenseTable.vue';
import AdminOrderFilters from '../components/admin/AdminOrderFilters.vue';
import AdminOrderTable from '../components/admin/AdminOrderTable.vue';
import AdminPagination from '../components/admin/AdminPagination.vue';
import { emptyLicenseFilters, type LicenseFilters } from '../components/admin/licenseTypes';
import { emptyOrderFilters, type OrderFilters } from '../components/admin/orderTypes';
import { formatDateTime, inDateRange, planLabel, sourceLabel, statusLabel, tierLabel, toDateOnly, yuan } from '../utils/format';

type AdminView = 'overview' | 'products' | 'versions' | 'users' | 'licenses' | 'leases' | 'selectors';
const ADMIN_VIEWS: AdminView[] = ['overview', 'products', 'versions', 'users', 'licenses', 'leases', 'selectors'];

const route = useRoute();
const adminView = computed<AdminView>(() => {
  const value = route.meta.adminView;
  return typeof value === 'string' && ADMIN_VIEWS.includes(value as AdminView) ? value as AdminView : 'overview';
});
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
const orderTotal = ref(0);
const remoteOrders = ref<AdminOrderItem[]>([]);
const remoteLicenses = ref<AdminLicenseItem[]>([]);
const licenseBatches = ref<AdminLicenseBatchItem[]>([]);
const remoteLeases = ref<AdminLeaseItem[]>([]);
const dauStats = ref<DauStat[]>([]);
const selectorVersion = ref<SelectorVersionItem>();
const productConfig = ref<AdminProductCatalogConfig>({ plans: [], downloads: [] });
const productPriceMessage = ref('');
const productDownloadMessage = ref('');
const productSavingSection = ref<'prices' | 'downloads' | ''>('');
const appVersions = ref<AppVersionItem[]>([]);
const versionForm = ref({
  version: '0.1.0',
  minAppVersion: '0.1.0',
  downloadUrl: '/v1/downloads/',
  downloadUrlMirror: '',
  releaseNotes: '',
  forceUpdate: false,
  isActive: true,
});
const editingVersionId = ref('');
const versionSaving = ref(false);
const versionMessage = ref('');

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
    平台标识: 'douyin',
    名称: '抖音创作者',
    图标: 'DY',
    发布页地址: 'https://creator.douyin.com/creator-micro/content/upload',
    匹配域名: ['creator.douyin.com', 'open.douyin.com'],
    就绪选择器: '.container-drag-VAfIfu, .semi-input.semi-input-default, .editor-comp-publish, [class*="container-drag"]',
    上传: {
      上传容器: '.container-drag-VAfIfu, [class*="container-drag"]',
      文件输入框: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
      上传完成标记: '.semi-input.semi-input-default, .editor-comp-publish, [class*="video-preview"], [class*="upload-success"]',
      编辑器就绪标记: '.semi-input.semi-input-default, .editor-comp-publish',
      超时毫秒: 180000,
      需要激活标签页: true,
    },
    字段: {
      标题: '.semi-input.semi-input-default',
      简介: '.editor-comp-publish, .editor-kit-container',
    },
  },
}, null, 2));
const selectorUploadMessage = ref('');

// 生成激活码相关
const generatePlan = ref<Plan>('monthly');
const generateTier = ref<LicenseTier>('basic');
const generateQuantity = ref(10);
const generateMaxDevices = ref(1);
const generateBatchName = ref('');
const generateSalesChannel = ref('third_party');
const generateNote = ref('');
const generateLoading = ref(false);
const generateResult = ref('');
const showGenerateDialog = ref(false);
const showReplaceDialog = ref(false);
const showLimitsDialog = ref(false);
const showNoteDialog = ref(false);
const licenseViewMode = ref<'grid' | 'table'>(localStorage.getItem('pubflow_admin_license_view') === 'grid' ? 'grid' : 'table');
const selectedLicenseCodes = ref<Set<string>>(new Set());
const selectedLicenseBatchId = ref('');
const showBulkLicenseDialog = ref(false);
const bulkLicenseAction = ref<'revoke' | 'delete'>('revoke');
const bulkLicenseReason = ref('');
const bulkDeleteConfirmation = ref('');
const bulkLicenseBusy = ref(false);
const bulkLicenseError = ref('');
const modalContentRef = ref<HTMLDivElement>();
const actionLicense = ref<AdminLicenseItem>();
const replaceReason = ref('');
const replaceRevokeOld = ref(true);
const replaceResult = ref('');
const limitsMaxDevices = ref(1);
const limitsMigrationLimit = ref(5);
const limitsReason = ref('');
const noteDraft = ref('');
const noteSaving = ref(false);
const noteMessage = ref('');

watch(showGenerateDialog, (open) => {
  if (open) nextTick(() => modalContentRef.value?.focus());
});

watch(adminView, () => {
  if (adminLoggedIn.value) void refreshCurrentView();
});

const orderFilters = ref<OrderFilters>(emptyOrderFilters());
const licenseFilters = ref<LicenseFilters>(emptyLicenseFilters());

watch(licenseViewMode, (value) => localStorage.setItem('pubflow_admin_license_view', value));
watch([licensePage, licensePageSize], () => clearLicenseSelection());
watch(licenseFilters, () => clearLicenseSelection(), { deep: true });

const adminTabs = [
  { key: 'overview', label: '总览', icon: Activity, routeName: 'admin-overview' },
  { key: 'products', label: '商品配置', icon: PackageOpen, routeName: 'admin-products' },
  { key: 'versions', label: '版本管理', icon: GitBranch, routeName: 'admin-versions' },
  { key: 'users', label: '订单管理', icon: WalletCards, routeName: 'admin-users' },
  { key: 'licenses', label: '卡密管理', icon: KeyRound, routeName: 'admin-licenses' },
  { key: 'leases', label: '授权记录', icon: ListChecks, routeName: 'admin-leases' },
  { key: 'selectors', label: 'Selector 状态', icon: DatabaseZap, routeName: 'admin-selectors' },
] as const;

const adminViewTitles: Record<AdminView, string> = {
  overview: '业务驾驶舱',
  products: '商品配置',
  versions: '版本管理',
  users: '订单管理',
  licenses: '卡密管理',
  leases: '授权记录',
  selectors: 'Selector 状态',
};

const DEFAULT_DOWNLOAD_PACKAGES: AdminDownloadConfig[] = [
  {
    code: 'zip',
    platform: 'extension',
    name: '离线包 (ZIP)',
    chip: 'Chrome / Edge / Chromium',
    fileName: 'pubflow-extension.zip',
    href: '/v1/downloads/pubflow-extension.zip',
    isActive: true,
    sortOrder: 100,
  },
  {
    code: 'crx',
    platform: 'extension',
    name: 'Chrome 扩展 (CRX)',
    chip: 'Chrome / Edge / Chromium',
    fileName: 'pubflow-extension.crx',
    href: '/v1/downloads/pubflow-extension.crx',
    isActive: true,
    sortOrder: 110,
  },
  {
    code: 'native-mac-arm64',
    platform: 'macos',
    name: 'PubFlow Native',
    chip: 'macOS / Apple Silicon',
    fileName: 'pubflow-pro-native-mac-arm64.zip',
    href: '/v1/downloads/pubflow-pro-native-mac-arm64.zip',
    isActive: true,
    sortOrder: 1100,
  },
  {
    code: 'native-mac-x64',
    platform: 'macos',
    name: 'PubFlow Native',
    chip: 'macOS / Intel',
    fileName: 'pubflow-pro-native-mac-x64.zip',
    href: '/v1/downloads/pubflow-pro-native-mac-x64.zip',
    isActive: true,
    sortOrder: 1110,
  },
  {
    code: 'native-win-x64',
    platform: 'windows',
    name: 'PubFlow Native',
    chip: 'Windows / x64',
    fileName: 'pubflow-pro-native-win-x64.zip',
    href: '/v1/downloads/pubflow-pro-native-win-x64.zip',
    isActive: true,
    sortOrder: 1120,
  },
  {
    code: 'native-linux-x64',
    platform: 'linux',
    name: 'PubFlow Native',
    chip: 'Linux / x64',
    fileName: 'pubflow-pro-native-linux-x64.zip',
    href: '/v1/downloads/pubflow-pro-native-linux-x64.zip',
    isActive: true,
    sortOrder: 1130,
  },
];

const normalizedLicenses = computed(() => {
  return remoteLicenses.value.map((item) => ({
    id: item.id,
    code: item.activationCode,
    user: item.userId ? `用户 #${item.userId}` : '未激活',
    plan: item.plan,
    tier: item.tier,
    maxDevices: item.maxDevices,
    deviceMigrationLimit: item.deviceMigrationLimit,
    deviceMigrationCount: item.deviceMigrationCount,
    lastMigratedAt: item.lastMigratedAt ? formatDateTime(item.lastMigratedAt) : '-',
    paidAt: toDateOnly(item.paidAt),
    createdAt: toDateOnly(item.createdAt),
    expiresAt: item.expiresAt ? toDateOnly(item.expiresAt) : '未激活',
    activatedAt: item.activatedAt ? formatDateTime(item.activatedAt) : '-',
    status: item.status || (item.isRevoked ? 'revoked' : item.activatedAt ? 'active' : 'pending'),
    orderNo: item.orderNo || '-',
    channel: item.orderChannel || '-',
    sourceChannel: item.sourceChannel || '-',
    batchName: item.batchName || '-',
    note: item.note || '',
    amountCents: item.amountCents || 0,
    clientInstallIds: item.clientInstallIds,
  }));
});

const filteredOrders = computed(() => {
  return remoteOrders.value.filter((item) => {
    const keyword = orderFilters.value.keyword.trim().toLowerCase();
    const inKeyword = !keyword || `${item.orderNo} ${item.channel} ${item.status} ${item.activationCode || ''}`.toLowerCase().includes(keyword);
    const inPlan = orderFilters.value.plan === 'all' || item.plan === orderFilters.value.plan;
    const inTier = orderFilters.value.tier === 'all' || item.tier === orderFilters.value.tier;
    const inStatus = orderFilters.value.status === 'all' || item.status === orderFilters.value.status;
    const paidAt = toDateOnly(item.paidAt);
    const expiresAt = item.expiresAt ? toDateOnly(item.expiresAt) : '未激活';
    const inPaidRange = inDateRange(paidAt, orderFilters.value.paidFrom, orderFilters.value.paidTo);
    const inExpireRange = expiresAt === '未激活'
      ? !(orderFilters.value.expiresFrom || orderFilters.value.expiresTo)
      : inDateRange(expiresAt, orderFilters.value.expiresFrom, orderFilters.value.expiresTo);
    return inKeyword && inTier && inPlan && inStatus && inPaidRange && inExpireRange;
  });
});

const filteredLicenses = computed(() => normalizedLicenses.value);

const orderSummary = computed(() => ({
  total: orderTotal.value,
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
const paginatedOrders = computed(() => filteredOrders.value);
const licenseTotalPages = computed(() => Math.max(1, Math.ceil(licenseTotal.value / licensePageSize.value)));
const selectedLicenseBatch = computed(() => licenseBatches.value.find((batch) => batch.id === selectedLicenseBatchId.value));
const bulkLicenseSelectedCount = computed(() => selectedLicenseBatch.value?.quantity ?? selectedLicenseCodes.value.size);
const visibleSelectedLicenseCodes = computed(() => selectedLicenseBatchId.value
  ? new Set(remoteLicenses.value.map((item) => item.activationCode))
  : selectedLicenseCodes.value);
const allCurrentLicensesSelected = computed(() => remoteLicenses.value.length > 0
  && remoteLicenses.value.every((item) => visibleSelectedLicenseCodes.value.has(item.activationCode)));
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
const latestAppVersion = computed(() => appVersions.value[0]);

function expandDownloadUrl(base: string, file: string): string {
  const trimmed = base.trim();
  if (!trimmed) return '';
  if (trimmed.endsWith(file)) return trimmed;
  const baseWithoutSlash = trimmed.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(baseWithoutSlash)) {
    return `${baseWithoutSlash}/${file}`;
  }
  return `${baseWithoutSlash}/${file}`.replace(/\/+/g, '/');
}

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
    void refreshCurrentView();
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
      tier: generateTier.value,
      plan: generatePlan.value,
      quantity: generateQuantity.value,
      maxDevices: generateMaxDevices.value,
      batchName: generateBatchName.value.trim() || undefined,
      salesChannel: generateSalesChannel.value.trim() || undefined,
      note: generateNote.value.trim() || undefined,
    });
    generateResult.value = `成功生成 ${result.items.length} 个激活码`;
    showGenerateDialog.value = false;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '生成失败';
  } finally {
    generateLoading.value = false;
  }
}

async function refreshLicensesOnly() {
  if (!adminToken.value) return;
  adminDataError.value = '';
  const [licenseResult, batches] = await Promise.all([
    listAdminLicenses(adminToken.value, {
      ...licenseFilters.value,
      page: licensePage.value,
      pageSize: licensePageSize.value,
    }),
    listAdminLicenseBatches(adminToken.value),
  ]);
  remoteLicenses.value = licenseResult.items;
  licenseBatches.value = batches;
  licenseTotal.value = licenseResult.total;
  licenseSummaryData.value = licenseResult.summary;
}

async function refreshAdminData() {
  if (!adminToken.value) return;
  adminLoading.value = true;
  adminDataError.value = '';
  try {
    // 应用默认时间筛选
    applyOverviewTimeRange();
    applyLeaseTimeRange();

    const [orderResult, licenseResult, selector, products, versions, batches] = await Promise.all([
      listAdminOrders(adminToken.value, { ...orderFilters.value, page: 1, pageSize: 100 }),
      listAdminLicenses(adminToken.value, { ...licenseFilters.value, page: licensePage.value, pageSize: licensePageSize.value }),
      getSelectorVersion(adminToken.value),
      getAdminProductCatalog(adminToken.value).catch((error) => {
        productPriceMessage.value = error instanceof Error ? error.message : '商品配置接口不可用';
        return productConfig.value;
      }),
      refreshAppVersions(),
      listAdminLicenseBatches(adminToken.value),
      refreshLeases(),
      refreshDauStats(),
    ]);
    remoteOrders.value = orderResult.items;
    orderTotal.value = orderResult.total;
    remoteLicenses.value = licenseResult.items;
    licenseTotal.value = licenseResult.total;
    licenseSummaryData.value = licenseResult.summary;
    licenseBatches.value = batches;
    selectorVersion.value = selector;
    productConfig.value = products;
    ensureTierPlans();
    appVersions.value = versions;
    ensureDownloadPackages();
  } catch (error) {
    adminDataError.value = error instanceof Error ? error.message : '后台数据加载失败，请确认服务端已启动';
  } finally {
    adminLoading.value = false;
  }
}

async function refreshCurrentView() {
  if (!adminToken.value) return;
  adminLoading.value = true;
  adminDataError.value = '';
  try {
    if (adminView.value === 'licenses') {
      await refreshLicensesOnly();
    } else if (adminView.value === 'versions') {
      appVersions.value = await refreshAppVersions();
    } else if (adminView.value === 'products') {
      productConfig.value = await getAdminProductCatalog(adminToken.value);
      ensureTierPlans();
      ensureDownloadPackages();
    } else if (adminView.value === 'leases') {
      applyLeaseTimeRange();
      await refreshLeases();
      await refreshDauStats();
    } else if (adminView.value === 'selectors') {
      selectorVersion.value = await getSelectorVersion(adminToken.value);
    } else if (adminView.value === 'users') {
      const result = await listAdminOrders(adminToken.value, {
        ...orderFilters.value,
        page: orderPage.value,
        pageSize: orderPageSize.value,
      });
      remoteOrders.value = result.items;
      orderTotal.value = result.total;
    } else {
      await refreshAdminData();
    }
  } catch (error) {
    adminDataError.value = error instanceof Error ? error.message : '后台数据加载失败，请确认服务端已启动';
  } finally {
    adminLoading.value = false;
  }
}

function ensureDownloadPackages() {
  const next = [...productConfig.value.downloads];
  for (const fallback of DEFAULT_DOWNLOAD_PACKAGES) {
    const existing = next.find((item) => item.code === fallback.code);
    if (!existing) {
      next.push({ ...fallback });
      continue;
    }
    existing.platform ||= fallback.platform;
    existing.name ||= fallback.name;
    existing.chip ||= fallback.chip;
    existing.fileName ||= fallback.fileName;
    existing.href ||= fallback.href;
    existing.sortOrder ??= fallback.sortOrder;
  }
  productConfig.value.downloads = next
    .filter((item) => DEFAULT_DOWNLOAD_PACKAGES.some((fallback) => fallback.code === item.code))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function ensureTierPlans() {
  const tiers: LicenseTier[] = ['basic', 'plus', 'pro'];
  const plans: Plan[] = ['monthly', 'yearly'];
  const next = [...productConfig.value.plans];
  for (const tier of tiers) {
    for (const plan of plans) {
      if (next.some((item) => item.tier === tier && item.id === plan)) continue;
      const base = next.find((item) => item.tier === 'basic' && item.id === plan)
        || next.find((item) => item.id === plan);
      next.push({
        id: plan,
        tier,
        name: base?.name || (plan === 'monthly' ? '月卡' : '年卡'),
        unit: base?.unit || (plan === 'monthly' ? '元/月' : '元/年'),
        note: base?.note || '',
        originalAmountCents: base?.originalAmountCents || (plan === 'monthly' ? 1490 : 9900),
        discountAmountCents: undefined,
        discountStartAt: undefined,
        discountEndAt: undefined,
        discountEnabled: false,
        isActive: false,
        sortOrder: tiers.indexOf(tier) * 100 + plans.indexOf(plan) * 10 + 10,
      });
    }
  }
  productConfig.value.plans = next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function saveProductSection(section: 'prices' | 'downloads') {
  if (!adminToken.value) return;
  productSavingSection.value = section;
  productPriceMessage.value = '';
  productDownloadMessage.value = '';
  try {
    ensureDownloadPackages();
    ensureTierPlans();
    productConfig.value = await saveAdminProductCatalog(adminToken.value, productConfig.value);
    ensureDownloadPackages();
    if (section === 'prices') {
      productPriceMessage.value = '价格配置已保存';
    } else {
      productDownloadMessage.value = '下载配置已保存';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '商品配置保存失败';
    if (section === 'prices') {
      productPriceMessage.value = message;
    } else {
      productDownloadMessage.value = message;
    }
  } finally {
    productSavingSection.value = '';
  }
}

function resetDownloadPackages() {
  productConfig.value.downloads = DEFAULT_DOWNLOAD_PACKAGES.map((item) => ({ ...item }));
  productDownloadMessage.value = '已恢复默认下载项，保存后生效';
}

async function refreshAppVersions() {
  if (!adminToken.value) return [];
  try {
    versionMessage.value = '';
    return await listAdminAppVersions(adminToken.value, 20);
  } catch (error) {
    versionMessage.value = error instanceof Error ? error.message : '版本记录加载失败';
    return appVersions.value;
  }
}

async function reloadAppVersions() {
  appVersions.value = await refreshAppVersions();
}

async function submitAppVersion() {
  if (!adminToken.value) return;
  versionSaving.value = true;
  versionMessage.value = '';
  try {
    const payload = {
      version: versionForm.value.version.trim(),
      minAppVersion: versionForm.value.minAppVersion.trim() || undefined,
      downloadUrl: versionForm.value.downloadUrl.trim(),
      downloadUrlMirror: versionForm.value.downloadUrlMirror.trim() || undefined,
      releaseNotes: versionForm.value.releaseNotes.trim() || undefined,
      forceUpdate: versionForm.value.forceUpdate,
      isActive: versionForm.value.isActive,
    };
    if (editingVersionId.value) {
      await updateAdminAppVersion(adminToken.value, editingVersionId.value, payload);
    } else {
      await createAdminAppVersion(adminToken.value, payload);
    }
    appVersions.value = await refreshAppVersions();
    versionMessage.value = editingVersionId.value ? '版本已保存' : '版本已发布';
    cancelVersionEdit();
  } catch (error) {
    versionMessage.value = error instanceof Error ? error.message : '版本保存失败';
  } finally {
    versionSaving.value = false;
  }
}

function editAppVersion(item: AppVersionItem) {
  editingVersionId.value = item.id;
  versionForm.value = {
    version: item.version,
    minAppVersion: item.minAppVersion || item.minVersion || '',
    downloadUrl: item.downloadUrl,
    downloadUrlMirror: item.downloadUrlMirror || '',
    releaseNotes: item.releaseNotes || '',
    forceUpdate: item.forceUpdate,
    isActive: item.isActive ?? true,
  };
  versionMessage.value = `正在编辑 v${item.version}`;
}

function cancelVersionEdit() {
  editingVersionId.value = '';
  versionForm.value = {
    version: latestAppVersion.value?.version || '0.1.0',
    minAppVersion: '0.1.0',
    downloadUrl: '/v1/downloads/',
    downloadUrlMirror: '',
    releaseNotes: '',
    forceUpdate: false,
    isActive: true,
  };
}

async function removeAppVersion(item: AppVersionItem) {
  if (!adminToken.value) return;
  const confirmed = window.confirm(`确认删除版本 v${item.version}？\n删除后插件和下载中心不会再读取这条记录。`);
  if (!confirmed) return;
  versionSaving.value = true;
  versionMessage.value = '';
  try {
    await deleteAdminAppVersion(adminToken.value, item.id);
    if (editingVersionId.value === item.id) {
      cancelVersionEdit();
    }
    appVersions.value = await refreshAppVersions();
    versionMessage.value = '版本记录已删除';
  } catch (error) {
    versionMessage.value = error instanceof Error ? error.message : '版本删除失败';
  } finally {
    versionSaving.value = false;
  }
}

function openReplaceDialog(item: AdminLicenseItem) {
  actionLicense.value = item;
  replaceReason.value = '';
  replaceRevokeOld.value = true;
  replaceResult.value = '';
  showReplaceDialog.value = true;
}

async function submitReplaceLicense() {
  if (!adminToken.value || !actionLicense.value) return;
  replaceResult.value = '';
  try {
    const result = await replaceLicense(adminToken.value, actionLicense.value.activationCode, replaceReason.value, replaceRevokeOld.value);
    replaceResult.value = `新激活码：${result.newActivationCode}`;
    await refreshLicensesOnly();
  } catch (error) {
    replaceResult.value = error instanceof Error ? error.message : '补发失败';
  }
}

async function revokeLicense(item: AdminLicenseItem) {
  if (!adminToken.value) return;
  const reason = window.prompt(`确认吊销这个卡密？\n${item.activationCode}\n\n可填写吊销原因：`, '后台手动吊销卡密');
  if (reason === null) return;
  try {
    await revokeAdminLicense(adminToken.value, item.activationCode, reason.trim() || undefined);
    generateResult.value = `已吊销激活码：${item.activationCode}`;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '吊销失败';
  }
}

async function deleteLicense(item: AdminLicenseItem) {
  if (!adminToken.value) return;
  const firstConfirm = window.confirm(`确认删除这个卡密？\n${item.activationCode}\n\n删除后默认不会再出现在卡密列表，关联授权会立即失效。`);
  if (!firstConfirm) return;
  const typedCode = window.prompt('为避免误删，请输入完整激活码确认删除：');
  if (typedCode === null) return;
  if (typedCode.trim().toUpperCase() !== item.activationCode.toUpperCase()) {
    generateResult.value = '激活码输入不一致，已取消删除。';
    return;
  }
  const reason = window.prompt('填写删除原因：', '后台删除测试卡密');
  if (reason === null) return;
  try {
    const result = await deleteAdminLicense(adminToken.value, item.activationCode, reason.trim() || undefined);
    generateResult.value = `已删除 ${item.activationCode}，失效 ${result.revokedLeases} 条授权`;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '删除卡密失败';
  }
}

async function freezeLicense(item: AdminLicenseItem) {
  if (!adminToken.value) return;
  const reason = window.prompt(`确认冻结当前活跃设备授权？\n${item.activationCode}\n\n这不会吊销卡密，但会让现有设备 lease 失效。`, '后台冻结当前设备授权');
  if (reason === null) return;
  try {
    const result = await freezeAdminLicense(adminToken.value, item.activationCode, reason.trim() || undefined);
    generateResult.value = `已冻结 ${item.activationCode}，失效 ${result.revokedLeases} 条授权`;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '冻结失败';
  }
}

async function unfreezeLicense(item: AdminLicenseItem) {
  if (!adminToken.value) return;
  const reason = window.prompt(`确认解除冻结？\n${item.activationCode}\n\n用户需要重新验证或重新激活后才能获得新 lease。`, '后台解除冻结');
  if (reason === null) return;
  const resetMigrationCount = window.confirm('是否同时重置迁移/解绑次数？\n仅在客服确认误伤时建议选择“确定”。');
  try {
    const result = await unfreezeAdminLicense(adminToken.value, item.activationCode, reason.trim() || undefined, resetMigrationCount);
    generateResult.value = `已解冻 ${item.activationCode}，当前迁移次数 ${result.deviceMigrationCount}`;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '解冻失败';
  }
}

async function unbindLicenseDevice(item: AdminLicenseItem) {
  if (!adminToken.value) return;
  const defaultInstallId = item.clientInstallIds.find(Boolean) || item.machineHashes.find(Boolean) || '';
  const clientInstallId = window.prompt(`输入要解绑的 client_install_id：\n${item.activationCode}`, defaultInstallId);
  if (clientInstallId === null) return;
  const normalizedClientInstallId = clientInstallId.trim();
  if (!normalizedClientInstallId) {
    generateResult.value = '设备标识不能为空';
    return;
  }
  const reason = window.prompt('填写后台解绑原因：', '客服后台解绑单个设备');
  if (reason === null) return;
  const consumeMigration = window.confirm('是否消耗一次用户迁移/解绑额度？\n正常换机建议选择“确定”，误伤修复选择“取消”。');
  try {
    const result = await unbindAdminLicenseDevice(
      adminToken.value,
      item.activationCode,
      normalizedClientInstallId,
      reason.trim() || undefined,
      consumeMigration,
    );
    generateResult.value = `已解绑设备，失效 ${result.revokedLeases} 条授权，迁移 ${result.deviceMigrationCount}/${result.deviceMigrationLimit}`;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '解绑设备失败';
  }
}

function openLimitsDialog(item: AdminLicenseItem) {
  actionLicense.value = item;
  limitsMaxDevices.value = item.maxDevices;
  limitsMigrationLimit.value = item.deviceMigrationLimit;
  limitsReason.value = '';
  showLimitsDialog.value = true;
}

function openNoteDialog(item: AdminLicenseItem) {
  actionLicense.value = item;
  noteDraft.value = item.note || '';
  noteMessage.value = '';
  showNoteDialog.value = true;
}

async function submitLicenseNote() {
  if (!adminToken.value || !actionLicense.value) return;
  noteSaving.value = true;
  noteMessage.value = '';
  try {
    await updateLicenseNote(
      adminToken.value,
      actionLicense.value.activationCode,
      noteDraft.value.trim() || undefined,
    );
    showNoteDialog.value = false;
    generateResult.value = noteDraft.value.trim() ? '卡密备注已保存' : '卡密备注已清空';
    await refreshLicensesOnly();
  } catch (error) {
    noteMessage.value = error instanceof Error ? error.message : '保存备注失败';
  } finally {
    noteSaving.value = false;
  }
}

async function submitLicenseLimits() {
  if (!adminToken.value || !actionLicense.value) return;
  try {
    await updateLicenseLimits(
      adminToken.value,
      actionLicense.value.activationCode,
      limitsMaxDevices.value,
      limitsMigrationLimit.value,
      limitsReason.value.trim() || undefined,
    );
    showLimitsDialog.value = false;
    await refreshLicensesOnly();
  } catch (error) {
    generateResult.value = error instanceof Error ? error.message : '调整限制失败';
  }
}

function planPrice(plan: AdminPlanConfig) {
  return (plan.originalAmountCents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function downloadTitle(item: AdminDownloadConfig) {
  return `${item.name || item.code} ${item.fileName ? `· ${item.fileName}` : ''}`;
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
  orderFilters.value = emptyOrderFilters();
  orderPage.value = 1;
  void refreshCurrentView();
}

function applyOrderFilters() {
  orderPage.value = 1;
  void refreshCurrentView();
}

function clearLicenseSelection() {
  selectedLicenseCodes.value = new Set();
  selectedLicenseBatchId.value = '';
}

function toggleLicenseSelection(item: AdminLicenseItem) {
  const next = selectedLicenseBatchId.value
    ? new Set(remoteLicenses.value.map((license) => license.activationCode))
    : new Set(selectedLicenseCodes.value);
  selectedLicenseBatchId.value = '';
  if (next.has(item.activationCode)) next.delete(item.activationCode);
  else next.add(item.activationCode);
  selectedLicenseCodes.value = next;
}

function toggleCurrentLicensePage() {
  if (selectedLicenseBatchId.value) {
    clearLicenseSelection();
    return;
  }
  const next = new Set(selectedLicenseCodes.value);
  if (allCurrentLicensesSelected.value) {
    remoteLicenses.value.forEach((item) => next.delete(item.activationCode));
  } else {
    remoteLicenses.value.forEach((item) => next.add(item.activationCode));
  }
  selectedLicenseCodes.value = next;
}

function selectFilteredLicenseBatch() {
  if (licenseFilters.value.batchId === 'all') return;
  selectedLicenseCodes.value = new Set();
  selectedLicenseBatchId.value = licenseFilters.value.batchId;
}

function openBulkLicenseDialog(action: 'revoke' | 'delete') {
  if (bulkLicenseSelectedCount.value === 0) return;
  bulkLicenseAction.value = action;
  bulkLicenseReason.value = '';
  bulkDeleteConfirmation.value = '';
  bulkLicenseError.value = '';
  showBulkLicenseDialog.value = true;
}

async function submitBulkLicenseAction() {
  if (!adminToken.value || bulkLicenseSelectedCount.value === 0) return;
  if (bulkLicenseAction.value === 'delete' && bulkDeleteConfirmation.value.trim() !== '确认删除') {
    bulkLicenseError.value = '请输入“确认删除”后再继续';
    return;
  }
  bulkLicenseBusy.value = true;
  bulkLicenseError.value = '';
  try {
    const result = await bulkAdminLicenseAction(adminToken.value, {
      action: bulkLicenseAction.value,
      activationCodes: selectedLicenseBatchId.value ? undefined : [...selectedLicenseCodes.value],
      batchId: selectedLicenseBatchId.value || undefined,
      reason: bulkLicenseReason.value.trim() || undefined,
    });
    showBulkLicenseDialog.value = false;
    clearLicenseSelection();
    generateResult.value = `已${bulkLicenseAction.value === 'delete' ? '删除' : '吊销'} ${result.affected} 张卡密，失效 ${result.revokedLeases} 条授权`;
    await refreshLicensesOnly();
  } catch (error) {
    bulkLicenseError.value = error instanceof Error ? error.message : '批量操作失败';
  } finally {
    bulkLicenseBusy.value = false;
  }
}

function resetLicenseFilters() {
  licenseFilters.value = emptyLicenseFilters();
  licensePage.value = 1;
  void refreshLicensesOnly();
}

function applyLicenseFilters() {
  licensePage.value = 1;
  void refreshLicensesOnly();
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportLicenses() {
  if (filteredLicenses.value.length === 0) return;
  const header = '激活码,备注,版本,套餐,状态,激活时间,授权到期,订单号,来源渠道,批次\n';
  const rows = filteredLicenses.value.map((item) =>
    [item.code, item.note, tierLabel(item.tier), planLabel(item.plan), statusLabel(item.status), item.activatedAt, item.expiresAt, item.orderNo, sourceLabel(item.sourceChannel), item.batchName].map(csvEscape).join(',')
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
  void refreshCurrentView();
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
      <RouterLink v-for="item in adminTabs" :key="item.key" :to="{ name: item.routeName }" :class="{ active: adminView === item.key }">
        <component :is="item.icon" :size="18" />
        {{ item.label }}
      </RouterLink>
      <button class="sidebar-logout" type="button" @click="logoutAdmin">
        <LogOut :size="18" />
        退出登录
      </button>
    </aside>

    <section class="admin-workspace">
      <header class="admin-topbar">
        <div>
          <span>运营后台</span>
          <h1>{{ adminViewTitles[adminView] }}</h1>
        </div>
        <div class="admin-actions">
          <button class="secondary-button compact" type="button" @click="refreshCurrentView">
            <RefreshCw :size="16" />
            {{ adminLoading ? '同步中' : '同步' }}
          </button>
          <RouterLink v-if="adminView !== 'licenses'" class="primary-button compact" :to="{ name: 'admin-licenses' }">卡密管理</RouterLink>
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
              <span><i class="legend-dot verifications"></i> 活跃安装实例</span>
            </div>
          </div>
        </div>
        <div class="review-lane">
          <div>
            <span>待激活卡密</span>
            <strong>{{ licenseSummary.pending }} 个卡密尚未被插件激活</strong>
            <RouterLink class="mini-action" :to="{ name: 'admin-licenses' }">查看授权</RouterLink>
          </div>
          <div>
            <span>已激活</span>
            <strong>{{ licenseSummary.active }} 个授权已被用户激活</strong>
            <RouterLink class="mini-action" :to="{ name: 'admin-licenses' }">查看授权</RouterLink>
          </div>
          <div>
            <span>版本治理</span>
            <strong>{{ latestAppVersion ? `插件 v${latestAppVersion.version}` : '暂无插件版本' }}</strong>
            <RouterLink class="mini-action" :to="{ name: 'admin-versions' }">进入版本库</RouterLink>
          </div>
        </div>
      </section>

      <section v-else-if="adminView === 'products'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>商品配置</span>
            <strong>价格和下载分开维护，避免发布配置互相影响</strong>
          </div>
        </div>

        <div class="product-admin-layout">
          <section class="product-config-section">
            <div class="config-section-head">
              <div>
                <span>价格管理</span>
                <strong>套餐价格、限时折扣、上下架</strong>
              </div>
              <button class="primary-button compact" type="button" :disabled="productSavingSection === 'prices'" @click="saveProductSection('prices')">
                {{ productSavingSection === 'prices' ? '保存中' : '保存价格' }}
              </button>
            </div>
            <p v-if="productPriceMessage" class="generate-result">{{ productPriceMessage }}</p>
            <div class="product-config-grid">
              <article v-for="plan in productConfig.plans" :key="`${plan.tier}-${plan.id}`" class="ops-config-panel">
                <div class="config-panel-head">
                  <strong>{{ tierLabel(plan.tier) }} · {{ plan.name || plan.id }}</strong>
                  <span>{{ planPrice(plan) }} 元</span>
                </div>
                <div class="ops-field-grid">
                  <label><span>名称</span><input v-model="plan.name" /></label>
                  <label><span>原价（分）</span><input v-model.number="plan.originalAmountCents" type="number" min="1" /></label>
                  <label><span>单位</span><input v-model="plan.unit" placeholder="元/月" /></label>
                  <label><span>折扣价（分）</span><input v-model.number="plan.discountAmountCents" type="number" min="1" /></label>
                  <label><span>折扣开始</span><input v-model="plan.discountStartAt" type="datetime-local" /></label>
                  <label><span>折扣结束</span><input v-model="plan.discountEndAt" type="datetime-local" /></label>
                </div>
                <label><span>说明</span><input v-model="plan.note" /></label>
                <div class="inline-toggle-row">
                  <label class="inline-toggle"><input v-model="plan.discountEnabled" type="checkbox" /> 启用限时折扣</label>
                  <label class="inline-toggle"><input v-model="plan.isActive" type="checkbox" /> 上架销售</label>
                </div>
              </article>
            </div>
          </section>

          <section class="product-config-section">
            <div class="config-section-head">
              <div>
                <span>下载管理</span>
                <strong>浏览器插件与 Native 多平台安装包</strong>
              </div>
              <div class="admin-actions">
                <button class="secondary-button compact" type="button" @click="resetDownloadPackages">恢复默认</button>
                <button class="primary-button compact" type="button" :disabled="productSavingSection === 'downloads'" @click="saveProductSection('downloads')">
                  {{ productSavingSection === 'downloads' ? '保存中' : '保存下载' }}
                </button>
              </div>
            </div>
            <p v-if="productDownloadMessage" class="generate-result">{{ productDownloadMessage }}</p>
            <div class="download-config-list">
              <article v-for="item in productConfig.downloads" :key="item.code" class="ops-config-panel download-config-panel">
                <div class="config-panel-head">
                  <strong>{{ downloadTitle(item) }}</strong>
                  <span>{{ item.code.toUpperCase() }}</span>
                </div>
                <div class="ops-field-grid">
                  <label><span>名称</span><input v-model="item.name" /></label>
                  <label><span>文件名</span><input v-model="item.fileName" /></label>
                  <label><span>说明</span><input v-model="item.chip" /></label>
                  <label><span>排序</span><input v-model.number="item.sortOrder" type="number" /></label>
                </div>
                <label><span>下载链接</span><input v-model="item.href" placeholder="https://... 或 /v1/downloads/pubflow-extension.zip" /></label>
                <label class="inline-toggle"><input v-model="item.isActive" type="checkbox" /> 展示下载</label>
              </article>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="adminView === 'versions'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>版本管理</span>
            <strong>发布插件版本、下载链接和 Markdown 更新日志</strong>
          </div>
          <div class="admin-actions">
            <button class="secondary-button compact" type="button" @click="reloadAppVersions">
              <RefreshCw :size="14" />
              刷新
            </button>
          </div>
        </div>
        <p v-if="versionMessage" class="generate-result">{{ versionMessage }}</p>

        <div class="version-admin-layout">
          <section class="version-publish-panel">
            <div class="config-section-head">
              <div>
                <span>{{ editingVersionId ? '编辑版本' : '发布新版本' }}</span>
                <strong>{{ editingVersionId ? '保存后立即影响插件更新检测和下载中心' : '插件启动和下载中心都会读取这里的最新记录' }}</strong>
              </div>
            </div>
            <div class="ops-field-grid">
              <label>
                <span>版本号</span>
                <input v-model="versionForm.version" placeholder="0.2.0" />
              </label>
              <label>
                <span>最低可用版本</span>
                <input v-model="versionForm.minAppVersion" placeholder="0.1.0" />
              </label>
              <label>
                <span>下载链接</span>
                <input v-model="versionForm.downloadUrl" placeholder="/v1/downloads/" />
              </label>
              <label>
                <span>镜像链接（可选）</span>
                <input v-model="versionForm.downloadUrlMirror" placeholder="https://github.com/.../releases/download/v0.1.0/" />
              </label>
            </div>
            <p class="form-hint muted">两个版本均为 Chrome Manifest V3 扩展，系统会自动拼接 pubflow-extension.zip 和 pubflow-extension.crx。</p>
            <label>
              <span>更新日志 Markdown</span>
              <textarea v-model="versionForm.releaseNotes" class="release-notes-input" placeholder="- 修复发布流程&#10;- 优化授权校验"></textarea>
            </label>
            <div class="inline-toggle-row">
              <label class="inline-toggle"><input v-model="versionForm.forceUpdate" type="checkbox" /> 标记为强提醒更新</label>
              <label class="inline-toggle"><input v-model="versionForm.isActive" type="checkbox" /> 立即生效</label>
            </div>
            <div class="selector-form-actions">
              <button v-if="editingVersionId" class="secondary-button compact" type="button" :disabled="versionSaving" @click="cancelVersionEdit">
                取消编辑
              </button>
              <button class="primary-button compact" type="button" :disabled="versionSaving" @click="submitAppVersion">
                {{ versionSaving ? '保存中' : editingVersionId ? '保存版本' : '发布版本' }}
              </button>
            </div>
          </section>

          <section class="version-history-panel">
            <div class="config-section-head">
              <div>
                <span>版本记录</span>
                <strong>{{ latestAppVersion ? `当前最新 v${latestAppVersion.version}` : '尚未发布版本' }}</strong>
              </div>
            </div>
            <div class="version-history-list">
              <article v-for="item in appVersions" :key="item.id" class="version-history-item">
                <div class="version-history-head">
                  <div>
                    <strong>v{{ item.version }}</strong>
                    <span>浏览器插件 · {{ formatDateTime(item.createdAt) }}</span>
                  </div>
                  <mark :class="item.forceUpdate ? 'status-amount_mismatch' : 'status-success'">
                    {{ item.forceUpdate ? '强提醒' : '普通' }}
                  </mark>
                </div>
                <div class="version-history-actions">
                  <button class="secondary-button compact" type="button" :disabled="versionSaving" @click="editAppVersion(item)">编辑</button>
                  <button class="secondary-button compact danger-action" type="button" :disabled="versionSaving" @click="removeAppVersion(item)">删除</button>
                </div>
                <code class="version-download-url">{{ item.downloadUrl }}</code>
                <a
                  v-for="file in ['pubflow-extension.zip', 'pubflow-extension.crx']"
                  :key="file"
                  class="version-download-link"
                  :href="expandDownloadUrl(item.downloadUrl, file)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ expandDownloadUrl(item.downloadUrl, file) }}
                </a>
                <code v-if="item.downloadUrlMirror" class="version-download-url mirror-url">镜像前缀：{{ item.downloadUrlMirror }}</code>
                <a
                  v-for="file in item.downloadUrlMirror ? ['pubflow-extension.zip', 'pubflow-extension.crx'] : []"
                  :key="`mirror-${file}`"
                  class="version-download-link mirror-link"
                  :href="expandDownloadUrl(item.downloadUrlMirror || '', file)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  镜像：{{ expandDownloadUrl(item.downloadUrlMirror || '', file) }}
                </a>
                <pre v-if="item.releaseNotes" class="version-notes-preview">{{ item.releaseNotes }}</pre>
                <p v-else class="modal-hint">未填写更新日志。</p>
              </article>
              <div v-if="appVersions.length === 0" class="list-empty">暂无版本记录，发布第一条后插件才会收到更新提示。</div>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="adminView === 'users'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>订单管理</span>
            <strong>订单、支付和授权状态集中查询</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ orderSummary.total }}</b>筛选结果</span>
            <span><b>{{ orderSummary.yearly }}</b>当前页年卡</span>
            <span><b>{{ orderSummary.monthly }}</b>当前页月卡</span>
            <span><b>{{ yuan(orderSummary.revenue) }}</b>当前页收入</span>
          </div>
        </div>
        <AdminOrderFilters v-model="orderFilters" :loading="adminLoading" @apply="applyOrderFilters" @reset="resetOrderFilters" />
        <AdminOrderTable :items="paginatedOrders" :loading="adminLoading" />
        <AdminPagination
          v-model:page="orderPage"
          v-model:page-size="orderPageSize"
          :total="orderTotal"
          :loading="adminLoading"
          @change="refreshCurrentView"
        />
      </section>

      <section v-else-if="adminView === 'licenses'" class="admin-table-view">
        <div class="operations-head license-operations-head">
          <div class="operations-title">
            <span>卡密管理</span>
            <strong>跟踪每一张卡密从发放到激活</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ licenseSummary.total }}</b>总计</span>
            <span><b>{{ licenseSummary.pending }}</b>待激活</span>
            <span><b>{{ licenseSummary.active }}</b>已激活</span>
            <span><b>{{ yuan(licenseSummary.revenue) }}</b>收入</span>
          </div>
          <div class="admin-actions">
            <button class="secondary-button compact" type="button" @click="exportLicenses">
              <Download :size="14" />
              导出 CSV
            </button>
            <button class="primary-button compact" type="button" @click="showGenerateDialog = true">生成卡密</button>
          </div>
        </div>
        <p v-if="generateResult" class="generate-result">{{ generateResult }}</p>
        <AdminLicenseFilters
          v-model="licenseFilters"
          :batches="licenseBatches"
          :loading="adminLoading"
          @apply="applyLicenseFilters"
          @reset="resetLicenseFilters"
        />
        <div class="license-list-toolbar">
          <div class="license-selection-actions">
            <button class="secondary-button compact" type="button" :disabled="remoteLicenses.length === 0" @click="toggleCurrentLicensePage">
              {{ allCurrentLicensesSelected || selectedLicenseBatchId ? '取消当前选择' : '选择当前页' }}
            </button>
            <button
              v-if="licenseFilters.batchId !== 'all'"
              class="secondary-button compact"
              type="button"
              :class="{ active: selectedLicenseBatchId === licenseFilters.batchId }"
              @click="selectFilteredLicenseBatch"
            >
              选择整个批次
            </button>
          </div>
          <div class="license-view-switch" aria-label="卡密查看方式">
            <button type="button" title="网格查看" :class="{ active: licenseViewMode === 'grid' }" @click="licenseViewMode = 'grid'"><LayoutGrid :size="16" /></button>
            <button type="button" title="表格查看" :class="{ active: licenseViewMode === 'table' }" @click="licenseViewMode = 'table'"><TableProperties :size="16" /></button>
          </div>
        </div>
        <div v-if="bulkLicenseSelectedCount > 0" class="license-bulk-toolbar">
          <strong>{{ selectedLicenseBatch ? `已选整个批次：${selectedLicenseBatch.batchName}` : `已选 ${bulkLicenseSelectedCount} 张卡密` }}</strong>
          <span v-if="selectedLicenseBatch">预计 {{ selectedLicenseBatch.quantity }} 张</span>
          <div>
            <button class="secondary-button compact" type="button" @click="openBulkLicenseDialog('revoke')">批量吊销</button>
            <button class="danger-button compact" type="button" @click="openBulkLicenseDialog('delete')"><Trash2 :size="14" />批量删除</button>
            <button class="license-clear-selection" type="button" title="清除选择" @click="clearLicenseSelection"><X :size="16" /></button>
          </div>
        </div>
        <AdminLicenseTable
          v-if="licenseViewMode === 'table'"
          :items="remoteLicenses"
          :selected-codes="visibleSelectedLicenseCodes"
          :loading="adminLoading"
          @toggle="toggleLicenseSelection"
          @toggle-page="toggleCurrentLicensePage"
          @note="openNoteDialog"
          @replace="openReplaceDialog"
          @limits="openLimitsDialog"
          @freeze="freezeLicense"
          @unfreeze="unfreezeLicense"
          @unbind="unbindLicenseDevice"
          @revoke="revokeLicense"
          @delete="deleteLicense"
        />
        <AdminLicenseGrid
          v-else
          :items="remoteLicenses"
          :selected-codes="visibleSelectedLicenseCodes"
          :loading="adminLoading"
          @toggle="toggleLicenseSelection"
          @note="openNoteDialog"
          @replace="openReplaceDialog"
          @limits="openLimitsDialog"
          @freeze="freezeLicense"
          @unfreeze="unfreezeLicense"
          @unbind="unbindLicenseDevice"
          @revoke="revokeLicense"
          @delete="deleteLicense"
        />
        <AdminPagination
          v-model:page="licensePage"
          v-model:page-size="licensePageSize"
          :total="licenseTotal"
          :loading="adminLoading"
          @change="refreshLicensesOnly"
        />
      </section>

      <section v-else-if="adminView === 'leases'" class="admin-table-view">
        <div class="operations-head">
          <div>
            <span>授权记录</span>
            <strong>插件启动、激活、校验、续租、设备迁移和 Selector 拉取事件</strong>
          </div>
          <div class="ops-kpis">
            <span><b>{{ remoteLeases.length }}</b>记录总数</span>
            <span><b>{{ leaseSuccessCount }}</b>成功</span>
            <span><b>{{ leaseFailedCount }}</b>失败</span>
          </div>
        </div>
        <div class="lease-filter-panel">
          <div class="lease-range-switch">
            <button v-for="r in (['week', 'month', 'custom'] as const)" :key="r" type="button" :class="{ active: leaseTimeRange === r }" @click="leaseTimeRange = r; applyLeaseTimeRange(); refreshLeases()">
              {{ r === 'week' ? '近7天' : r === 'month' ? '近30天' : '自定义' }}
            </button>
          </div>
          <div v-if="leaseTimeRange === 'custom'" class="lease-custom-dates">
              <input v-model="leaseDateFrom" type="date" @change="refreshLeases()" />
              <span>至</span>
              <input v-model="leaseDateTo" type="date" @change="refreshLeases()" />
          </div>
          <button class="secondary-button compact" type="button" @click="refreshLeases">
            <RefreshCw :size="14" />
            刷新
          </button>
        </div>
        <AdminLeaseTable :items="paginatedLeases" :loading="adminLoading" />
        <AdminPagination
          v-model:page="leasePage"
          v-model:page-size="leasePageSize"
          :total="remoteLeases.length"
          :loading="adminLoading"
        />
      </section>

      <section v-else class="selector-vault">
        <div class="selector-status-card">
          <div class="selector-status-head">
            <Layers3 :size="28" />
            <div>
              <strong>Selector 版本状态</strong>
              <p>保留功能：当前 v0.2 Pro 插件使用本地 Selector，这里仅作为未来远程配置版本库，不参与插件运行链路。</p>
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
            <span>版本层级</span>
            <select v-model="generateTier">
              <option value="basic">Basic</option>
              <option value="plus">Plus</option>
              <option value="pro">Pro</option>
            </select>
          </label>
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
            <span>最大安装实例数</span>
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
          <label>
            <span>卡密备注</span>
            <textarea v-model="generateNote" maxlength="500" rows="3" placeholder="例如：赠送给张先生，用于小红书项目"></textarea>
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

    <AdminDialog
      :open="showNoteDialog"
      title="编辑卡密备注"
      :description="actionLicense?.activationCode"
      :busy="noteSaving"
      @close="showNoteDialog = false"
    >
      <div class="admin-form-stack">
        <label>
          <span>备注内容</span>
          <textarea v-model="noteDraft" maxlength="500" rows="5" placeholder="记录赠送对象、联系方式或用途"></textarea>
        </label>
        <small>{{ noteDraft.length }}/500，清空后保存即可删除备注。</small>
        <p v-if="noteMessage" class="dialog-error">{{ noteMessage }}</p>
      </div>
      <template #footer>
        <button class="secondary-button compact" type="button" :disabled="noteSaving" @click="showNoteDialog = false">取消</button>
        <button class="primary-button compact" type="button" :disabled="noteSaving" @click="submitLicenseNote">
          {{ noteSaving ? '保存中' : '保存备注' }}
        </button>
      </template>
    </AdminDialog>

    <AdminDialog
      :open="showBulkLicenseDialog"
      :title="bulkLicenseAction === 'delete' ? '批量删除卡密' : '批量吊销卡密'"
      :description="selectedLicenseBatch ? `将处理整个批次：${selectedLicenseBatch.batchName}` : `将处理已选的 ${bulkLicenseSelectedCount} 张卡密`"
      :busy="bulkLicenseBusy"
      @close="showBulkLicenseDialog = false"
    >
      <div class="admin-form-stack">
        <p class="bulk-license-warning">
          {{ bulkLicenseAction === 'delete'
            ? '删除后卡密不再出现在管理列表，关联的有效授权也会立即失效。'
            : '吊销后卡密不能再激活，关联的有效授权会立即失效。' }}
        </p>
        <label>
          <span>操作原因</span>
          <textarea v-model="bulkLicenseReason" rows="3" :placeholder="bulkLicenseAction === 'delete' ? '例如：误生成批次' : '例如：卡密泄露'" />
        </label>
        <label v-if="bulkLicenseAction === 'delete'">
          <span>输入“确认删除”继续</span>
          <input v-model="bulkDeleteConfirmation" autocomplete="off" placeholder="确认删除" />
        </label>
        <p v-if="bulkLicenseError" class="dialog-error">{{ bulkLicenseError }}</p>
      </div>
      <template #footer>
        <button class="secondary-button compact" type="button" :disabled="bulkLicenseBusy" @click="showBulkLicenseDialog = false">取消</button>
        <button
          :class="bulkLicenseAction === 'delete' ? 'danger-button compact' : 'primary-button compact'"
          type="button"
          :disabled="bulkLicenseBusy || (bulkLicenseAction === 'delete' && bulkDeleteConfirmation.trim() !== '确认删除')"
          @click="submitBulkLicenseAction"
        >
          {{ bulkLicenseBusy ? '处理中' : bulkLicenseAction === 'delete' ? '确认批量删除' : '确认批量吊销' }}
        </button>
      </template>
    </AdminDialog>

    <div
      v-if="showReplaceDialog"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="补发激活码"
      @click.self="showReplaceDialog = false"
      @keydown.escape="showReplaceDialog = false"
    >
      <div class="modal-content" tabindex="-1">
        <div class="modal-header">
          <h3>补发激活码</h3>
          <button class="icon-button" type="button" aria-label="关闭" @click="showReplaceDialog = false">
            <X :size="20" />
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">原激活码：{{ actionLicense?.activationCode }}</p>
          <label>
            <span>补发原因</span>
            <input v-model="replaceReason" placeholder="例如用户换机失败、卡密泄露" />
          </label>
          <label class="inline-toggle">
            <input v-model="replaceRevokeOld" type="checkbox" />
            同时注销原激活码并吊销关联 Lease
          </label>
          <p v-if="replaceResult" class="generate-result">{{ replaceResult }}</p>
        </div>
        <div class="modal-footer">
          <button class="secondary-button compact" type="button" @click="showReplaceDialog = false">关闭</button>
          <button class="primary-button compact" type="button" @click="submitReplaceLicense">确认补发</button>
        </div>
      </div>
    </div>

    <div
      v-if="showLimitsDialog"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="调整设备限制"
      @click.self="showLimitsDialog = false"
      @keydown.escape="showLimitsDialog = false"
    >
      <div class="modal-content" tabindex="-1">
        <div class="modal-header">
          <h3>调整设备限制</h3>
          <button class="icon-button" type="button" aria-label="关闭" @click="showLimitsDialog = false">
            <X :size="20" />
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">当前激活码：{{ actionLicense?.activationCode }}；已迁移 {{ actionLicense?.deviceMigrationCount ?? 0 }} 次。</p>
          <label>
            <span>最大安装实例数</span>
            <input v-model.number="limitsMaxDevices" type="number" min="1" max="20" />
          </label>
          <label>
            <span>迁移次数上限</span>
            <input v-model.number="limitsMigrationLimit" type="number" min="0" max="100" />
          </label>
          <label>
            <span>调整原因</span>
            <input v-model="limitsReason" placeholder="例如用户重装系统，补一次迁移额度" />
          </label>
        </div>
        <div class="modal-footer">
          <button class="secondary-button compact" type="button" @click="showLimitsDialog = false">取消</button>
          <button class="primary-button compact" type="button" @click="submitLicenseLimits">保存限制</button>
        </div>
      </div>
    </div>
  </main>
</template>
