export function planLabel(plan: string) {
  return plan === 'yearly' ? '年卡' : '月卡';
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
