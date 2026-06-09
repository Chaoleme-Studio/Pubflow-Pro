import type { PlatformSelectorConfig } from '../types';

export const weiboSelectorConfig = {
  平台标识: 'weibo',
  名称: '微博',
  图标: 'WB',
  发布页地址: 'https://weibo.com',
  文章发布页地址: 'https://card.weibo.com/article/v5/editor#/draft',
  匹配域名: ['weibo.com', 'www.weibo.com', 'card.weibo.com'],
  就绪选择器: '.wbpro-form, [class*="wbpro-form"], textarea',
  文章就绪选择器: 'textarea[placeholder*="标题"], .tiptap.ProseMirror',
  上传: {
    上传容器: '.wbpro-form, [class*="wbpro-form"]',
    文件输入框: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    上传完成标记: '[class*="wbpro-form"] video, video',
    编辑器就绪标记: '.wbpro-form, [class*="wbpro-form"]',
    超时毫秒: 180000,
  },
  图文上传: {
    上传容器: '[class*="wbpro-form"], [class*="upload"], [class*="Upload"]',
    文件输入框: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    上传完成标记: '[class*="wbpro-form"] img, [class*="image-preview"], [class*="upload-success"], [class*="image-list"]',
    编辑器就绪标记: '.wbpro-form, [class*="wbpro-form"]',
    超时毫秒: 180000,
  },
  字段: {
    标题: '',
    简介: '.wbpro-form, [class*="wbpro-form"]',
    文章正文: 'div[contenteditable="true"], [contenteditable="true"]',
    // 微博不支持单独上传封面，视频前几帧即为封面
    声明: {
      触发器: 'button',
      类型: 'button',
      选项文本: '内容无需标注',
    },
    谁可以看: {
      触发器: 'div[class*="_es_1oo0f_"]',
      类型: 'dropdown',
      选项选择器: 'div[class*="_pop2_1oo0f_"] div[class*="woo-pop-item-main"]',
    },
  },
  文章字段: {
    标题: 'textarea[placeholder*="标题"]',
    标题填充方式: 'inputValue',
    简介: 'textarea[placeholder*="导语"]',
    文章正文: '.tiptap.ProseMirror[contenteditable="true"]',
  },
} satisfies PlatformSelectorConfig;
