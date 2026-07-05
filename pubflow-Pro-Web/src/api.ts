export type Plan = 'monthly' | 'yearly';
export type PayChannel = 'wechat' | 'alipay';
export type Platform = 'macos' | 'windows' | 'linux' | 'extension';

export interface PlanOption {
  id: Plan;
  name: string;
  price: string;
  unit: string;
  note: string;
  amountCents: number;
  originalAmountCents?: number;
  discountAmountCents?: number;
  discountStartAt?: string;
  discountEndAt?: string;
  discountEnabled: boolean;
  isDiscountActive: boolean;
  savingsCents: number;
}

export interface DownloadOption {
  platform: Platform;
  name: string;
  chip: string;
  fileName: string;
  href: string;
}

export interface OrderResult {
  orderNo: string;
  payUrl: string;
  qrCode?: string;
  queryToken: string;
}

export interface AdminLoginResult {
  token: string;
  username: string;
}

export interface AdminFilters {
  keyword?: string;
  plan?: string;
  clientInstallId?: string;
  machineHash?: string;
  paidFrom?: string;
  paidTo?: string;
  expiresFrom?: string;
  expiresTo?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminLicenseItem {
  id: string;
  activationCode: string;
  tier: string;
  plan: Plan;
  status: string;
  sourceChannel: string;
  batchId?: string;
  batchName?: string;
  userId?: number;
  maxDevices: number;
  deviceMigrationLimit: number;
  deviceMigrationCount: number;
  lastMigratedAt?: string;
  isRevoked: boolean;
  clientInstallIds: string[];
  machineHashes: string[];
  orderNo?: string;
  orderChannel?: string;
  amountCents?: number;
  paidAt?: string;
  createdAt: string;
  expiresAt?: string;
  activatedAt?: string;
}

export interface SelectorVersionItem {
  version: number;
  minAppVersion: string;
  createdAt: string;
  protocolVersion?: number;
  protocolPublicKey?: string;
}

export interface UploadSelectorPayload {
  version: number;
  minAppVersion?: string;
  selectors: Record<string, unknown>;
}

export interface ProductCatalog {
  plans: PlanOption[];
  downloads: DownloadOption[];
}

export interface AppVersionItem {
  id: string;
  platform: string;
  version: string;
  latestVersion: string;
  minVersion: string;
  minAppVersion?: string;
  downloadUrl: string;
  downloadUrlMirror?: string;
  releaseNotes: string;
  forceUpdate: boolean;
  isActive?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateAppVersionParams {
  version: string;
  minAppVersion?: string;
  downloadUrl: string;
  downloadUrlMirror?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  isActive?: boolean;
}

const EXTENSION_VERSION_STREAM = 'extension';

export interface LicenseLookupResult {
  plan: string;
  status: string;
  maxDevices: number;
  deviceMigrationLimit: number;
  deviceMigrationCount: number;
  activeInstallCount: number;
  expiresAt?: string;
  activatedAt?: string;
}

export interface ResetDevicesResult {
  revokedLeases: number;
  deviceMigrationCount: number;
  deviceMigrationLimit: number;
}

export interface AdminPlanConfig {
  id: Plan;
  name: string;
  unit?: string;
  note?: string;
  originalAmountCents: number;
  discountAmountCents?: number;
  discountStartAt?: string;
  discountEndAt?: string;
  discountEnabled: boolean;
  isActive: boolean;
  sortOrder?: number;
}

export interface AdminDownloadConfig {
  code: string;
  platform: Platform | string;
  name: string;
  chip?: string;
  fileName?: string;
  href: string;
  isActive: boolean;
  sortOrder?: number;
}

export interface AdminProductCatalogConfig {
  plans: AdminPlanConfig[];
  downloads: AdminDownloadConfig[];
}

export interface AdminOrderItem {
  id: string;
  orderNo: string;
  plan: Plan;
  channel: string;
  status: string;
  machineHash?: string;
  activationCode?: string;
  amountCents: number;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface GenerateLicenseParams {
  plan: Plan;
  quantity?: number;
  maxDevices?: number;
  batchName?: string;
  salesChannel?: string;
}

export interface LicenseSummary {
  total: number;
  pending: number;
  active: number;
  revenueCents: number;
}

export interface LicenseListResult {
  items: AdminLicenseItem[];
  summary: LicenseSummary;
  total: number;
  page: number;
  pageSize: number;
}

export interface GenerateLicenseResult {
  items: AdminLicenseItem[];
}

export interface AdminLeaseItem {
  id: string;
  activationCode: string;
  clientInstallId: string;
  machineHash: string;
  platform: string;
  ipAddress: string;
  eventType: string;
  status: string;
  reason?: string;
  operator?: string;
  targetId?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface DauStat {
  date: string;
  activations: number;
  verifications: number;
}

const FETCH_TIMEOUT_MS = 15_000;
const API_BASE_URL = (import.meta.env.VITE_PUBFLOW_API_BASE_URL || '').trim().replace(/\/+$/, '');

export const FALLBACK_PRODUCT_CATALOG: ProductCatalog = {
  plans: [
    {
      id: 'monthly',
      name: '月卡',
      price: '14.9',
      unit: '月',
      note: '适合短期项目和试用',
      amountCents: 1490,
      originalAmountCents: 1490,
      discountEnabled: false,
      isDiscountActive: false,
      savingsCents: 0,
    },
    {
      id: 'yearly',
      name: '年卡',
      price: '99',
      unit: '年',
      note: '适合长期运营团队',
      amountCents: 9900,
      originalAmountCents: 9900,
      discountEnabled: false,
      isDiscountActive: false,
      savingsCents: 0,
    },
  ],
  downloads: [
    {
      platform: 'extension',
      name: '离线包 (ZIP)',
      chip: 'Chrome / Edge / Chromium',
      fileName: 'pubflow-extension.zip',
      href: '/v1/downloads/pubflow-extension.zip',
    },
    {
      platform: 'extension',
      name: 'Chrome 扩展 (CRX)',
      chip: 'Chrome / Edge / Chromium',
      fileName: 'pubflow-extension.crx',
      href: '/v1/downloads/pubflow-extension.crx',
    },
  ],
};

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(apiUrl(url), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path) || !API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'macos';
}

/**
 * 验证机器码格式
 * 机器码应该是 64 位十六进制字符串（SHA-256 哈希）
 */
export function validateMachineHash(hash: string): { valid: boolean; error?: string } {
  const trimmed = hash.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: '请输入机器码' };
  }
  if (trimmed.length !== 64) {
    return { valid: false, error: '机器码长度应为 64 位' };
  }
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    return { valid: false, error: '机器码只能包含十六进制字符（0-9, a-f）' };
  }
  return { valid: true };
}

export async function getProductCatalog(): Promise<ProductCatalog> {
  let response: Response;
  try {
    response = await fetchWithTimeout('/v1/product/catalog');
  } catch (error) {
    const detail = error instanceof Error && error.name === 'AbortError'
      ? '请求超时'
      : error instanceof Error && error.message
        ? error.message
        : '网络不可用';
    throw new Error(`产品配置加载失败：${detail}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`产品配置加载失败：HTTP ${response.status}`);
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  const plans = arrayOfRecord(data.plans).map((item) => ({
    id: normalizePlan(item.id) ?? 'monthly',
    name: String(item.name ?? ''),
    price: String(item.price ?? ''),
    unit: String(item.unit ?? ''),
    note: String(item.note ?? ''),
    amountCents: Number(item.amount_cents ?? item.amountCents ?? 0),
    originalAmountCents: numberOrUndefined(item.original_amount_cents ?? item.originalAmountCents),
    discountAmountCents: numberOrUndefined(item.discount_amount_cents ?? item.discountAmountCents),
    discountStartAt: stringOrUndefined(item.discount_start_at ?? item.discountStartAt),
    discountEndAt: stringOrUndefined(item.discount_end_at ?? item.discountEndAt),
    discountEnabled: Boolean(item.discount_enabled ?? item.discountEnabled),
    isDiscountActive: Boolean(item.is_discount_active ?? item.isDiscountActive),
    savingsCents: Number(item.savings_cents ?? item.savingsCents ?? 0),
  }));
  const downloads = arrayOfRecord(data.downloads).map((item) => ({
    platform: normalizePlatform(item.platform) ?? 'macos',
    name: String(item.name ?? ''),
    chip: String(item.chip ?? ''),
    fileName: String(item.file_name ?? item.fileName ?? ''),
    href: String(item.href ?? ''),
  }));
  if (!plans.length) {
    throw new Error('产品配置加载失败：未返回可购买套餐');
  }
  return { plans, downloads };
}

export async function getAdminProductCatalog(token: string): Promise<AdminProductCatalogConfig> {
  const response = await fetchWithTimeout('/v1/admin/product/catalog', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('商品配置加载失败');
  }
  return normalizeAdminProductCatalog((payload?.data ?? payload) as Record<string, unknown>);
}

export async function saveAdminProductCatalog(
  token: string,
  config: AdminProductCatalogConfig,
): Promise<AdminProductCatalogConfig> {
  const response = await fetchWithTimeout('/v1/admin/product/catalog', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plans: config.plans.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        note: item.note,
        original_amount_cents: item.originalAmountCents,
        discount_amount_cents: item.discountAmountCents,
        discount_start_at: dateTimeLocalToIso(item.discountStartAt),
        discount_end_at: dateTimeLocalToIso(item.discountEndAt),
        discount_enabled: item.discountEnabled,
        is_active: item.isActive,
        sort_order: item.sortOrder,
      })),
      downloads: config.downloads.map((item) => ({
        code: item.code,
        platform: item.platform,
        name: item.name,
        chip: item.chip,
        file_name: item.fileName,
        href: item.href,
        is_active: item.isActive,
        sort_order: item.sortOrder,
      })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '商品配置保存失败'));
  }
  return normalizeAdminProductCatalog((payload?.data ?? payload) as Record<string, unknown>);
}

export async function getRecentAppVersions(limit = 3): Promise<AppVersionItem[]> {
  const params = new URLSearchParams();
  params.set('platform', EXTENSION_VERSION_STREAM);
  params.set('limit', String(limit));
  const response = await fetchWithTimeout(`/v1/product/versions?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('版本信息加载失败');
  }
  return normalizeVersionList(payload);
}

export async function listAdminAppVersions(
  token: string,
  limit = 20,
): Promise<AppVersionItem[]> {
  const params = new URLSearchParams();
  params.set('platform', EXTENSION_VERSION_STREAM);
  params.set('limit', String(limit));
  const response = await fetchWithTimeout(`/v1/admin/versions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '版本记录加载失败'));
  }
  return normalizeVersionList(payload);
}

export async function createAdminAppVersion(
  token: string,
  params: CreateAppVersionParams,
): Promise<AppVersionItem> {
  const response = await fetchWithTimeout('/v1/admin/versions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      platform: EXTENSION_VERSION_STREAM,
      version: params.version,
      min_app_version: params.minAppVersion,
      download_url: params.downloadUrl,
      download_url_mirror: params.downloadUrlMirror,
      release_notes: params.releaseNotes,
      force_update: params.forceUpdate,
      is_active: params.isActive,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '版本发布失败'));
  }
  return normalizeVersionItem((payload?.data ?? payload) as Record<string, unknown>);
}

export async function updateAdminAppVersion(
  token: string,
  id: string,
  params: CreateAppVersionParams,
): Promise<AppVersionItem> {
  const response = await fetchWithTimeout(`/v1/admin/versions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      platform: EXTENSION_VERSION_STREAM,
      version: params.version,
      min_app_version: params.minAppVersion,
      download_url: params.downloadUrl,
      download_url_mirror: params.downloadUrlMirror,
      release_notes: params.releaseNotes,
      force_update: params.forceUpdate,
      is_active: params.isActive,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '版本保存失败'));
  }
  return normalizeVersionItem((payload?.data ?? payload) as Record<string, unknown>);
}

export async function deleteAdminAppVersion(token: string, id: string): Promise<boolean> {
  const response = await fetchWithTimeout(`/v1/admin/versions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '版本删除失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return Boolean(data.deleted ?? true);
}

export async function replaceLicense(
  token: string,
  activationCode: string,
  reason: string,
  revokeOld: boolean,
): Promise<{ newActivationCode: string; revokedOld: boolean }> {
  const response = await fetchWithTimeout('/v1/admin/licenses/replace', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      reason,
      revoke_old: revokeOld,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('补发激活码失败');
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    newActivationCode: String(data.new_activation_code ?? data.newActivationCode ?? ''),
    revokedOld: Boolean(data.revoked_old ?? data.revokedOld),
  };
}

export async function revokeAdminLicense(
  token: string,
  activationCode: string,
  reason?: string,
): Promise<boolean> {
  const response = await fetchWithTimeout('/v1/admin/licenses/revoke', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      reason,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '吊销激活码失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return Boolean(data.revoked ?? true);
}

export async function deleteAdminLicense(
  token: string,
  activationCode: string,
  reason?: string,
): Promise<{ deleted: boolean; revokedLeases: number }> {
  const response = await fetchWithTimeout('/v1/admin/licenses/delete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      reason,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '删除卡密失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    deleted: Boolean(data.deleted ?? true),
    revokedLeases: Number(data.revoked_leases ?? data.revokedLeases ?? 0),
  };
}

export async function freezeAdminLicense(
  token: string,
  activationCode: string,
  reason?: string,
): Promise<{ frozen: boolean; revokedLeases: number }> {
  const response = await fetchWithTimeout('/v1/admin/licenses/freeze', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      reason,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '冻结当前设备授权失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    frozen: Boolean(data.frozen ?? true),
    revokedLeases: Number(data.revoked_leases ?? data.revokedLeases ?? 0),
  };
}

export async function unfreezeAdminLicense(
  token: string,
  activationCode: string,
  reason?: string,
  resetMigrationCount?: boolean,
): Promise<{ unfrozen: boolean; deviceMigrationCount: number }> {
  const response = await fetchWithTimeout('/v1/admin/licenses/unfreeze', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      reason,
      reset_migration_count: resetMigrationCount,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '解冻授权失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    unfrozen: Boolean(data.unfrozen ?? true),
    deviceMigrationCount: Number(data.device_migration_count ?? data.deviceMigrationCount ?? 0),
  };
}

export async function unbindAdminLicenseDevice(
  token: string,
  activationCode: string,
  clientInstallId: string,
  reason?: string,
  consumeMigration?: boolean,
): Promise<{ revokedLeases: number; deviceMigrationCount: number; deviceMigrationLimit: number }> {
  const response = await fetchWithTimeout('/v1/admin/licenses/unbind-device', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      client_install_id: clientInstallId,
      reason,
      consume_migration: consumeMigration,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error(apiErrorMessage(payload, '后台解绑设备失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    revokedLeases: Number(data.revoked_leases ?? data.revokedLeases ?? 0),
    deviceMigrationCount: Number(data.device_migration_count ?? data.deviceMigrationCount ?? 0),
    deviceMigrationLimit: Number(data.device_migration_limit ?? data.deviceMigrationLimit ?? 0),
  };
}

export async function updateLicenseLimits(
  token: string,
  activationCode: string,
  maxDevices: number,
  deviceMigrationLimit: number,
  reason?: string,
): Promise<AdminLicenseItem> {
  const response = await fetchWithTimeout('/v1/admin/licenses/limits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activation_code: activationCode,
      max_devices: maxDevices,
      device_migration_limit: deviceMigrationLimit,
      reason,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('调整设备限制失败');
  }
  const data = ((payload?.data ?? payload) as Record<string, unknown>).item as Record<string, unknown> | undefined;
  return normalizeLicenseItem(data ?? {});
}

export async function lookupLicense(activationCode: string): Promise<LicenseLookupResult> {
  const response = await fetchWithTimeout('/v1/license/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: activationCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('未找到这个激活码，或服务暂时不可用');
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    plan: String(data.plan ?? ''),
    status: String(data.status ?? ''),
    maxDevices: Number(data.max_devices ?? data.maxDevices ?? 0),
    deviceMigrationLimit: Number(data.device_migration_limit ?? data.deviceMigrationLimit ?? 0),
    deviceMigrationCount: Number(data.device_migration_count ?? data.deviceMigrationCount ?? 0),
    activeInstallCount: Number(data.active_install_count ?? data.activeInstallCount ?? 0),
    expiresAt: stringOrUndefined(data.expires_at ?? data.expiresAt),
    activatedAt: stringOrUndefined(data.activated_at ?? data.activatedAt),
  };
}

export async function selfReplaceLicense(activationCode: string, reason?: string): Promise<string> {
  const response = await fetchWithTimeout('/v1/license/replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: activationCode, reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('补发失败，请确认旧激活码有效');
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return String(data.new_activation_code ?? data.newActivationCode ?? '');
}

export async function selfRevokeLicense(activationCode: string, reason?: string): Promise<boolean> {
  const response = await fetchWithTimeout('/v1/license/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: activationCode, reason }),
  });
  if (!response.ok) {
    throw new Error('注销失败，请确认激活码有效');
  }
  return true;
}

export async function selfResetDevices(activationCode: string, reason?: string): Promise<ResetDevicesResult> {
  const response = await fetchWithTimeout('/v1/license/reset-devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: activationCode, reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiMessage(payload, '解除旧设备占用失败'));
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  return {
    revokedLeases: Number(data.revoked_leases ?? data.revokedLeases ?? 0),
    deviceMigrationCount: Number(data.device_migration_count ?? data.deviceMigrationCount ?? 0),
    deviceMigrationLimit: Number(data.device_migration_limit ?? data.deviceMigrationLimit ?? 0),
  };
}

export async function createOrder(plan: Plan, channel: PayChannel): Promise<OrderResult> {
  const response = await fetchWithTimeout('/v1/purchase/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, channel }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('订单创建失败，请稍后重试');
  }
  const data = payload?.data ?? payload;
  const payUrl = data.pay_url ?? data.payUrl ?? '';
  const qrCode = data.qr_code ?? data.qrCode ?? '';
  const orderNo = data.order_no ?? data.orderNo;
  const queryToken = data.query_token ?? data.queryToken ?? '';
  if (!orderNo) throw new Error('订单创建失败：未返回订单号');
  return {
    orderNo,
    payUrl: /^https?:\/\//.test(payUrl) ? payUrl : '',
    qrCode: typeof qrCode === 'string' && qrCode ? qrCode : undefined,
    queryToken,
  };
}

export interface OrderStatus {
  orderNo: string;
  status: string;
  activationCode?: string;
  licenseId?: string;
}

export async function getOrderStatus(orderNo: string, queryToken: string): Promise<OrderStatus> {
  const encodedOrderNo = encodeURIComponent(orderNo);
  const response = await fetchWithTimeout(`/v1/purchase/orders/${encodedOrderNo}?token=${encodeURIComponent(queryToken)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('查询订单状态失败');
  }
  const data = ((payload as Record<string, unknown>)?.data ?? payload) as Record<string, unknown>;
  return {
    orderNo: String(data.order_no ?? data.orderNo ?? ''),
    status: String(data.status ?? ''),
    activationCode: stringOrUndefined(data.activation_code ?? data.activationCode),
    licenseId: stringOrUndefined(data.license_id ?? data.licenseId),
  };
}

export async function adminLogin(username: string, password: string): Promise<AdminLoginResult> {
  const response = await fetchWithTimeout('/v1/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('用户名或密码错误');
  }
  const data = payload?.data ?? payload;
  return {
    token: String(data.token ?? ''),
    username: String(data.username ?? ''),
  };
}

export async function listAdminLicenses(token: string, filters: AdminFilters): Promise<LicenseListResult> {
  const payload = await adminGet('/v1/admin/licenses', token, filters);
  const body = payload as Record<string, unknown>;
  const data = (body?.data ?? body) as Record<string, unknown>;
  const items = normalizeList(payload).map(normalizeLicenseItem);
  const summary = (data.summary as Record<string, unknown>) ?? {};
  return {
    items,
    summary: {
      total: Number(summary.total ?? 0),
      pending: Number(summary.pending ?? 0),
      active: Number(summary.active ?? 0),
      revenueCents: Number(summary.revenue_cents ?? summary.revenueCents ?? 0),
    },
    total: Number(data.total ?? data.total_items ?? items.length),
    page: Number(data.page ?? data.page_index ?? 1),
    pageSize: Number(data.page_size ?? data.pageSize ?? 20),
  };
}

export async function listAdminOrders(token: string, filters: AdminFilters): Promise<AdminOrderItem[]> {
  const payload = await adminGet('/v1/admin/orders', token, filters);
  return normalizeList(payload).map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ''),
    orderNo: String(item.order_no ?? item.orderNo ?? ''),
    plan: normalizePlan(item.plan) ?? 'monthly',
    channel: String(item.channel ?? ''),
    status: String(item.status ?? ''),
    machineHash: stringOrUndefined(item.machine_hash ?? item.machineHash),
    activationCode: stringOrUndefined(item.activation_code ?? item.activationCode),
    amountCents: Number(item.amount_cents ?? item.amountCents ?? 0),
    paidAt: stringOrUndefined(item.paid_at ?? item.paidAt),
    createdAt: String(item.created_at ?? item.createdAt ?? ''),
    updatedAt: String(item.updated_at ?? item.updatedAt ?? ''),
    expiresAt: stringOrUndefined(item.expires_at ?? item.expiresAt),
  }));
}

export async function getSelectorVersion(token: string): Promise<SelectorVersionItem | undefined> {
  const response = await fetchWithTimeout('/v1/selector/version', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return undefined;
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  if (!data.version) return undefined;
  return {
    version: Number(data.version),
    minAppVersion: String(data.min_app_version ?? data.minAppVersion ?? ''),
    createdAt: String(data.created_at ?? data.createdAt ?? ''),
    protocolVersion: numberOrUndefined(data.protocol_version ?? data.protocolVersion),
    protocolPublicKey: stringOrUndefined(data.protocol_public_key ?? data.protocolPublicKey),
  };
}

export async function uploadSelector(token: string, payload: UploadSelectorPayload): Promise<SelectorVersionItem> {
  const response = await fetchWithTimeout('/v1/admin/selector/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: payload.version,
      min_app_version: payload.minAppVersion,
      selectors: payload.selectors,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('登录已过期，请重新登录');
    }
    throw new Error('Selector 上传失败，请检查配置后重试');
  }
  const data = (body?.data ?? body) as Record<string, unknown>;
  return {
    version: Number(data.version),
    minAppVersion: payload.minAppVersion ?? '',
    createdAt: new Date().toISOString(),
  };
}

async function adminGet(path: string, token: string, filters: AdminFilters): Promise<unknown> {
  const params = new URLSearchParams();
  addParam(params, 'keyword', filters.keyword);
  addParam(params, 'plan', filters.plan === 'all' ? '' : filters.plan);
  addParam(params, 'client_install_id', filters.clientInstallId);
  addParam(params, 'machine_hash', filters.machineHash);
  addParam(params, 'status', filters.status === 'all' ? '' : filters.status);
  addParam(params, 'paid_from', filters.paidFrom);
  addParam(params, 'paid_to', filters.paidTo);
  addParam(params, 'expires_from', filters.expiresFrom);
  addParam(params, 'expires_to', filters.expiresTo);
  if (filters.page) params.set('page', String(filters.page));
  params.set('page_size', String(filters.pageSize ?? 20));

  const response = await fetchWithTimeout(`${path}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('登录已过期，请重新登录');
    }
    throw new Error('数据加载失败，请稍后重试');
  }
  return payload;
}

function addParam(params: URLSearchParams, key: string, value?: string) {
  const normalized = value?.trim();
  if (normalized) params.set(key, normalized);
}

function normalizeList(payload: unknown): Record<string, unknown>[] {
  const body = payload as Record<string, unknown>;
  const data = (body?.data ?? body) as Record<string, unknown>;
  const items = data.items ?? data.results ?? data.list;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

function normalizePlan(value: unknown): Plan | undefined {
  return value === 'monthly' || value === 'yearly' ? value : undefined;
}

function normalizePlatform(value: unknown): Platform | undefined {
  return value === 'macos' || value === 'windows' || value === 'linux' || value === 'extension' ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return undefined;
}

function readApiMessage(payload: unknown, fallback: string) {
  const body = payload as {
    message?: string;
    error?: {
      message?: string;
      errors?: Array<{ message?: string; reason?: string }>;
    };
  };
  return body?.error?.errors?.[0]?.message || body?.error?.message || body?.message || fallback;
}

function arrayOfString(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function arrayOfRecord(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

// ============================================================
// Admin License 生成 API
// ============================================================

/**
 * 批量生成激活码
 * 管理员在后台调用，预生成一批激活码供用户购买
 */
export async function generateLicenses(
  token: string,
  params: GenerateLicenseParams
): Promise<GenerateLicenseResult> {
  const response = await fetchWithTimeout('/v1/admin/licenses/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan: params.plan,
      quantity: params.quantity ?? 1,
      max_devices: params.maxDevices ?? 1,
      batch_name: params.batchName,
      sales_channel: params.salesChannel,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('生成失败，请稍后重试');
  }
  const data = ((payload as Record<string, unknown>)?.data ?? payload) as Record<string, unknown>;
  const items = normalizeList(data).map(normalizeLicenseItem);
  return { items };
}

// ============================================================
// Admin Lease 记录 API
// ============================================================

export async function listAdminLeases(
  token: string,
  from?: string,
  to?: string
): Promise<AdminLeaseItem[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  const path = `/v1/admin/leases${query ? `?${query}` : ''}`;
  const response = await fetchWithTimeout(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('数据加载失败，请稍后重试');
  }
  const body = payload as Record<string, unknown>;
  const wrapper = body?.data as Record<string, unknown> | undefined;
  const raw = wrapper?.items ?? wrapper;
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
  return items.map((item) => ({
    id: String(item.id ?? ''),
    activationCode: String(item.activation_code ?? item.activationCode ?? ''),
    clientInstallId: String(item.client_install_id ?? item.clientInstallId ?? item.machine_hash ?? item.machineHash ?? ''),
    machineHash: String(item.machine_hash ?? item.machineHash ?? ''),
    platform: String(item.platform ?? ''),
    ipAddress: String(item.ip_address ?? item.ipAddress ?? ''),
    eventType: String(item.event_type ?? item.eventType ?? ''),
    status: String(item.status ?? ''),
    reason: stringOrUndefined(item.reason),
    operator: stringOrUndefined(item.operator),
    targetId: stringOrUndefined(item.target_id ?? item.targetId),
    expiresAt: stringOrUndefined(item.expires_at ?? item.expiresAt),
    createdAt: String(item.created_at ?? item.createdAt ?? ''),
  }));
}

function normalizeLicenseItem(item: Record<string, unknown>): AdminLicenseItem {
  return {
    id: String(item.id ?? ''),
    activationCode: String(item.activation_code ?? item.activationCode ?? ''),
    tier: String(item.tier ?? ''),
    plan: normalizePlan(item.plan) ?? 'monthly',
    status: String(item.status ?? ''),
    sourceChannel: String(item.source_channel ?? item.sourceChannel ?? ''),
    batchId: stringOrUndefined(item.batch_id ?? item.batchId),
    batchName: stringOrUndefined(item.batch_name ?? item.batchName),
    userId: numberOrUndefined(item.user_id ?? item.userId),
    maxDevices: Number(item.max_devices ?? item.maxDevices ?? 1),
    deviceMigrationLimit: Number(item.device_migration_limit ?? item.deviceMigrationLimit ?? 3),
    deviceMigrationCount: Number(item.device_migration_count ?? item.deviceMigrationCount ?? 0),
    lastMigratedAt: stringOrUndefined(item.last_migrated_at ?? item.lastMigratedAt),
    isRevoked: Boolean(item.is_revoked ?? item.isRevoked),
    clientInstallIds: arrayOfString(item.client_install_ids ?? item.clientInstallIds ?? item.machine_hashes ?? item.machineHashes),
    machineHashes: arrayOfString(item.machine_hashes ?? item.machineHashes),
    orderNo: stringOrUndefined(item.order_no ?? item.orderNo),
    orderChannel: stringOrUndefined(item.order_channel ?? item.orderChannel),
    amountCents: numberOrUndefined(item.amount_cents ?? item.amountCents),
    paidAt: stringOrUndefined(item.paid_at ?? item.paidAt),
    createdAt: String(item.created_at ?? item.createdAt ?? ''),
    expiresAt: stringOrUndefined(item.expires_at ?? item.expiresAt),
    activatedAt: stringOrUndefined(item.activated_at ?? item.activatedAt),
  };
}

function normalizeAdminProductCatalog(data: Record<string, unknown>): AdminProductCatalogConfig {
  return {
    plans: arrayOfRecord(data.plans).map((item) => ({
      id: normalizePlan(item.id) ?? 'monthly',
      name: String(item.name ?? ''),
      unit: stringOrUndefined(item.unit),
      note: stringOrUndefined(item.note),
      originalAmountCents: Number(item.original_amount_cents ?? item.originalAmountCents ?? item.amount_cents ?? item.amountCents ?? 0),
      discountAmountCents: numberOrUndefined(item.discount_amount_cents ?? item.discountAmountCents),
      discountStartAt: isoToDateTimeLocal(stringOrUndefined(item.discount_start_at ?? item.discountStartAt)),
      discountEndAt: isoToDateTimeLocal(stringOrUndefined(item.discount_end_at ?? item.discountEndAt)),
      discountEnabled: Boolean(item.discount_enabled ?? item.discountEnabled),
      isActive: Boolean(item.is_active ?? item.isActive ?? true),
      sortOrder: numberOrUndefined(item.sort_order ?? item.sortOrder),
    })),
    downloads: arrayOfRecord(data.downloads)
      .map((item) => ({
        code: String(item.code ?? item.platform ?? ''),
        platform: String(item.platform ?? ''),
        name: String(item.name ?? ''),
        chip: stringOrUndefined(item.chip),
        fileName: stringOrUndefined(item.file_name ?? item.fileName),
        href: String(item.href ?? ''),
        isActive: Boolean(item.is_active ?? item.isActive ?? true),
        sortOrder: numberOrUndefined(item.sort_order ?? item.sortOrder),
      }))
      .filter(isExtensionDownloadConfig),
  };
}

function normalizeVersionList(payload: unknown): AppVersionItem[] {
  const body = payload as Record<string, unknown>;
  const data = (body?.data ?? body) as Record<string, unknown>;
  const items = data.items ?? data.results ?? data.list;
  if (Array.isArray(items)) {
    return (items as Record<string, unknown>[]).map(normalizeVersionItem);
  }
  if (data.version || data.latest_version || data.latestVersion) {
    return [normalizeVersionItem(data)];
  }
  return [];
}

function normalizeVersionItem(item: Record<string, unknown>): AppVersionItem {
  const version = String(item.version ?? item.latest_version ?? item.latestVersion ?? '');
  const minVersion = String(item.min_version ?? item.minVersion ?? item.min_app_version ?? item.minAppVersion ?? '');
  return {
    id: String(item.id ?? `${item.platform ?? EXTENSION_VERSION_STREAM}-${version}`),
    platform: String(item.platform ?? EXTENSION_VERSION_STREAM),
    version,
    latestVersion: String(item.latest_version ?? item.latestVersion ?? version),
    minVersion,
    minAppVersion: stringOrUndefined(item.min_app_version ?? item.minAppVersion ?? minVersion),
    downloadUrl: String(item.download_url ?? item.downloadUrl ?? ''),
    downloadUrlMirror: stringOrUndefined(item.download_url_mirror ?? item.downloadUrlMirror),
    releaseNotes: String(item.release_notes ?? item.releaseNotes ?? ''),
    forceUpdate: Boolean(item.force_update ?? item.forceUpdate),
    isActive: item.is_active === undefined && item.isActive === undefined
      ? undefined
      : Boolean(item.is_active ?? item.isActive),
    createdAt: String(item.created_at ?? item.createdAt ?? ''),
    updatedAt: stringOrUndefined(item.updated_at ?? item.updatedAt),
  };
}

function isExtensionDownloadConfig(item: AdminDownloadConfig) {
  return item.platform === 'extension'
    || item.code === 'zip'
    || item.code === 'crx'
    || /\.(zip|crx)$/i.test(item.fileName || item.href);
}

function apiErrorMessage(payload: unknown, fallback: string) {
  const body = payload as Record<string, unknown>;
  const error = body?.error as Record<string, unknown> | undefined;
  return String(error?.message ?? body?.message ?? fallback);
}

function isoToDateTimeLocal(value?: string): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const date = new Date(time);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToIso(value?: string): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  return new Date(time).toISOString();
}

export async function getDauStats(
  token: string,
  from?: string,
  to?: string
): Promise<DauStat[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  const path = `/v1/admin/leases/dau${query ? `?${query}` : ''}`;
  const response = await fetchWithTimeout(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    throw new Error('数据加载失败，请稍后重试');
  }
  const body = payload as Record<string, unknown>;
  const wrapper = body?.data as Record<string, unknown> | undefined;
  const raw = wrapper?.items ?? wrapper;
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
  return items.map((item) => ({
    date: String(item.date ?? ''),
    activations: Number(item.activations ?? 0),
    verifications: Number(item.verifications ?? 0),
  }));
}
