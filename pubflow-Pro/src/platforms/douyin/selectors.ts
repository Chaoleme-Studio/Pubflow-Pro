import type { PlatformSelectorConfig } from '../types';

export const douyinSelectorConfig = {
  平台标识: 'douyin',
  名称: '抖音创作者',
  图标: 'DY',
  发布页地址: 'https://creator.douyin.com/creator-micro/content/upload',
  图文发布页地址: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
  文章发布页地址: 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5',
  文章入口按钮: 'button:has-text("我要发文"), button:has-text("发文")',
  匹配域名: ['creator.douyin.com', 'open.douyin.com'],
  就绪选择器:
    '.container-drag-VAfIfu, .semi-input.semi-input-default, .editor-comp-publish, [class*="container-drag"]',
  文章就绪选择器: 'input[placeholder*="文章标题"], .tiptap.ProseMirror',
  上传: {
    上传容器: '.container-drag-VAfIfu, [class*="container-drag"]',
    文件输入框: [
      '.container-drag-VAfIfu input[type="file"]',
      '[class*="container-drag"] input[type="file"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记:
      '.semi-input.semi-input-default, .editor-comp-publish, [class*="video-preview"], [class*="upload-success"]',
    编辑器就绪标记: '.semi-input.semi-input-default, .editor-comp-publish',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  图文上传: {
    上传容器: '[class*="upload"], [class*="Upload"]',
    文件输入框: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    上传完成标记: '[class*="image-preview"], [class*="upload-success"], [class*="image-list"]',
    编辑器就绪标记: '.semi-input.semi-input-default, .editor-comp-publish',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: '.semi-input.semi-input-default',
    简介:
      '.zone-container.editor-kit-container.editor.editor-comp-publish.notranslate.chrome.window.chrome88, .editor-comp-publish, .editor-kit-container',
    文章正文: 'div[contenteditable="true"][class*="editor"], .article-editor [contenteditable="true"], div[contenteditable="true"]',
    封面: '.coverControl-CjlzqC, [class*="coverControl"], .filter-k_CjvJ, [class*="filter-k"]',
    声明: {
      触发器: '.selectText-XSrMFZ, [class*="selectText"]',
      类型: 'dropdown',
      选项文本: '无需添加自主声明',
    },
    谁可以看: {
      触发器: 'input[type="checkbox"]',
      类型: 'radio',
    },
    定时发布: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
      时间输入: 'input.semi-input[placeholder="日期和时间"]',
    },
  },
  图文字段: {
    标题: '.semi-input.semi-input-default',
    简介:
      '.zone-container.editor-kit-container.editor.editor-comp-publish.notranslate.chrome.window.chrome88, .editor-comp-publish, .editor-kit-container',
    封面: '.coverControl-CjlzqC, [class*="coverControl"], .filter-k_CjvJ, [class*="filter-k"]',
    声明: {
      触发器: '.selectText-XSrMFZ, [class*="selectText"]',
      类型: 'dropdown',
      选项文本: '无需添加自主声明',
    },
    谁可以看: {
      触发器: 'input[type="checkbox"]',
      类型: 'radio',
    },
    定时发布: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
      时间输入: 'input.semi-input[placeholder="日期和时间"]',
    },
  },
  文章字段: {
    标题: 'input[placeholder*="文章标题"]',
    标题填充方式: 'inputValue',
    简介: 'input[placeholder*="内容摘要"]',
    文章正文: '.tiptap.ProseMirror[contenteditable="true"]',
    封面: '[class*="content-upload"][class*="ksKds3"], [class*="content-upload"], [class*="headCover"], [class*="cover-container"]',
    谁可以看: {
      触发器: 'input[type="checkbox"]',
      类型: 'radio',
    },
    定时发布: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
      时间输入: 'input.semi-input[placeholder="日期和时间"]',
    },
  },
} satisfies PlatformSelectorConfig;
