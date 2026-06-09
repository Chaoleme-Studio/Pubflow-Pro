import type { PlatformSelectorConfig } from '../types';

export const xiguaSelectorConfig = {
  平台标识: 'xigua',
  名称: '西瓜视频',
  图标: 'XG',
  启用: false,
  发布页地址: 'https://creator.ixigua.com/upload',
  匹配域名: ['creator.ixigua.com'],
  就绪选择器: 'input, textarea',
  上传: {
    上传容器: '',
    文件输入框: ['input[type="file"]'],
    上传完成标记: 'video',
    编辑器就绪标记: 'input, textarea',
    超时毫秒: 240000,
    需要激活标签页: true,
  },
  字段: {
    标题: 'input[placeholder*="标题"]',
    简介: 'textarea[placeholder*="简介"]',
    封面: '[class*="cover"], [class*="Cover"], [class*="thumb"], [class*="Thumb"]',
  },
} satisfies PlatformSelectorConfig;
