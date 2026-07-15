import type { PlatformSelectorConfig } from '../types';

export const xSelectorConfig = {
  平台标识: 'x',
  名称: 'X',
  图标: 'X',
  支持内容类型: ['video'],
  发布页地址: 'https://x.com/compose/post',
  匹配域名: ['x.com'],
  检测通用弹窗: false,
  就绪选择器: '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"], input[data-testid="fileInput"]',
  上传: {
    上传容器: 'main, [role="dialog"], [data-testid="primaryColumn"]',
    文件输入框: [
      'input[data-testid="fileInput"][type="file"]',
      'input[type="file"][accept*="video"]',
    ],
    // 这里只表示附件预览已经出现；content.ts 还会继续等待附件 role=status 显示“就绪”。
    上传完成标记: '[data-testid="attachments"] video, [data-testid="media-preview-item"], video[src^="blob:"]',
    编辑器就绪标记: '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: '',
    简介: '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]',
  },
} satisfies PlatformSelectorConfig;
