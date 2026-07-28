export function planLabel(plan: string) {
  if (plan === 'yearly') return '年卡';
  return '月卡';
}

export function tierLabel(tier: string) {
  if (tier === 'basic') return 'Basic';
  if (tier === 'plus') return 'Plus';
  if (tier === 'pro') return 'Pro';
  return tier || '-';
}

export function sourceLabel(source: string) {
  if (source === 'wechat') return '微信';
  if (source === 'alipay') return '支付宝';
  if (source === 'manual') return '手动';
  if (source === 'official') return '官网';
  if (source === 'third_party') return '三方平台';
  return source || '-';
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    active: '正常',
    pending: '待激活',
    paid: '已支付',
    revoked: '已吊销',
    expired: '已过期',
    success: '成功',
    failed: '失败',
    warning: '警告',
    disabled: '已停用',
    deleted: '已删除',
    amount_mismatch: '金额异常',
  };
  return map[status] || status;
}

export function eventLabel(type: string) {
  const map: Record<string, string> = {
    activate: '激活',
    verify: '校验',
    renew: '续租',
    deactivate: '解绑',
    device_migrate: '设备迁移',
    device_rebind: '设备重绑',
    self_replace: '自助补发',
    self_revoke: '自助注销',
    self_reset_devices: '自助解绑设备',
    adjust_limits: '调整设备额度',
    admin_revoke: '后台吊销',
    admin_delete: '后台删除',
    admin_freeze: '后台冻结',
    admin_unfreeze: '后台解冻',
    admin_unbind_device: '后台解绑设备',
    generate_licenses: '批量生成卡密',
    replace: '后台补发',
    product_catalog_save: '商品配置保存',
    app_version_create: '版本发布',
    app_version_update: '版本更新',
    app_version_delete: '版本删除',
    selector_publish: 'Selector 发布',
    permit: '发布许可',
    challenge: '设备挑战',
    risk_flag: '风控标记',
    selector_fetch: 'Selector 拉取',
  };
  return map[type] || type || '-';
}

export function yuan(cents: number) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toDateOnly(value?: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function formatDateTime(value?: string) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16);
}

export function shortHash(value: string) {
  if (!value || value === '待绑定') return value || '-';
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

export function inDateRange(value: string, from: string, to: string) {
  if (!value && (from || to)) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}
