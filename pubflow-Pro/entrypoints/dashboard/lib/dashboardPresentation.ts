import { isCurrentMonth, isToday } from '../../../src/shared/date';

export type ViewKey = 'dashboard' | 'publish' | 'videos' | 'records' | 'settings';

export const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'dashboard', label: '数据概览' },
  { key: 'publish', label: '发布视频' },
  { key: 'videos', label: '我的视频' },
  { key: 'records', label: '数据中心' },
  { key: 'settings', label: '设置' },
];

const navIcons: Record<ViewKey, string> = {
  dashboard:
    '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  publish:
    '<path d="M12 4v16m8-8H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  videos:
    '<rect x="2" y="3" width="20" height="14" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><polygon points="10,7 16,10 10,13" fill="currentColor"/>',
  records:
    '<path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  settings:
    '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

export function navIcon(key: ViewKey): string {
  return navIcons[key];
}

export function viewDescription(view: ViewKey): string {
  if (view === 'dashboard') return '今日数据总览、热点内容和任务进度。';
  if (view === 'publish') return '上传视频、填写信息、选择平台，一键分发。';
  if (view === 'videos') return '所有视频资产，查看各平台发布状态和数据。';
  if (view === 'records') return '各平台发布记录、阅读数据和操作入口。';
  return '配置渠道、填充策略、AI 助手和本地数据。';
}

export function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '未发',
    filling: '进行中',
    publishing: '发布中',
    filled: '待确认',
    published: '已发布',
    skipped: '未选择',
    error: '失败',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
  };
  return map[status] || status;
}

export function statusClass(status: string) {
  const map: Record<string, string> = {
    published: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    filled: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    filling: 'bg-amber-50 text-amber-700 ring-amber-200',
    publishing: 'bg-rose-50 text-rose-700 ring-rose-200',
    pending: 'bg-slate-100 text-slate-600 ring-slate-200',
    skipped: 'bg-slate-100 text-slate-500 ring-slate-200',
    error: 'bg-red-50 text-red-700 ring-red-200',
  };
  return map[status] || 'bg-slate-100 text-slate-600 ring-slate-200';
}

export function campaignTypeText(type: string) {
  const map: Record<string, string> = {
    activityCenter: '活动',
    growth: '成长',
    monetization: '收益',
    brand: '商单',
    training: '训练',
  };
  return map[type] || type;
}

export function formatDate(timestamp?: number) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function formatViews(views?: number) {
  if (views == null) return '-';
  return views >= 10000 ? `${(views / 10000).toFixed(1)}w` : String(views);
}

export function formatBytes(size?: number) {
  if (!size) return '-';
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export { isToday, isCurrentMonth };
