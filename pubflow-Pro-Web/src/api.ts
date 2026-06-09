export type Plan = 'monthly' | 'yearly';
export type PayChannel = 'wechat' | 'alipay';
export type Platform = 'macos' | 'windows' | 'linux';

export interface PlanOption {
  id: Plan;
  name: string;
  price: string;
  unit: string;
  note: string;
  amountCents: number;
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
  queryToken: string;
}

export interface AdminLoginResult {
  token: string;
  username: string;
}

export interface AdminFilters {
  keyword?: string;
  plan?: string;
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
  isRevoked: boolean;
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
}

export interface UploadSelectorPayload {
  version: number;
  minAppVersion?: string;
  selectors: Record<string, Record<string, string>>;
}

export interface ProductCatalog {
  plans: PlanOption[];
  downloads: DownloadOption[];
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
  plan: 'monthly' | 'yearly';
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
  machineHash: string;
  platform: string;
  ipAddress: string;
  eventType: string;
  status: string;
  reason?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface DauStat {
  date: string;
  activations: number;
  verifications: number;
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const response = await fetchWithTimeout('/v1/product/catalog');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('产品配置加载失败，请稍后重试');
  }
  const data = (payload?.data ?? payload) as Record<string, unknown>;
  const plans = arrayOfRecord(data.plans).map((item) => ({
    id: normalizePlan(item.id) ?? 'monthly',
    name: String(item.name ?? ''),
    price: String(item.price ?? ''),
    unit: String(item.unit ?? ''),
    note: String(item.note ?? ''),
    amountCents: Number(item.amount_cents ?? item.amountCents ?? 0),
  }));
  const downloads = arrayOfRecord(data.downloads).map((item) => ({
    platform: normalizePlatform(item.platform) ?? 'macos',
    name: String(item.name ?? ''),
    chip: String(item.chip ?? ''),
    fileName: String(item.file_name ?? item.fileName ?? ''),
    href: String(item.href ?? ''),
  }));
  return { plans, downloads };
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
  const orderNo = data.order_no ?? data.orderNo;
  const queryToken = data.query_token ?? data.queryToken ?? '';
  if (!orderNo) throw new Error('订单创建失败：未返回订单号');
  return {
    orderNo,
    payUrl: /^https?:\/\//.test(payUrl) ? payUrl : '',
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
  return value === 'macos' || value === 'windows' || value === 'linux' ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return undefined;
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
    machineHash: String(item.machine_hash ?? item.machineHash ?? ''),
    platform: String(item.platform ?? ''),
    ipAddress: String(item.ip_address ?? item.ipAddress ?? ''),
    eventType: String(item.event_type ?? item.eventType ?? ''),
    status: String(item.status ?? ''),
    reason: stringOrUndefined(item.reason),
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
    isRevoked: Boolean(item.is_revoked ?? item.isRevoked),
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
