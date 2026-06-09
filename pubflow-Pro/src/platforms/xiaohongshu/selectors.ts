import type { PlatformSelectorConfig } from '../types';

export const xiaohongshuSelectorConfig = {
  平台标识: 'xiaohongshu',
  名称: '小红书',
  图标: 'XHS',
  支持内容类型: ['video', 'image'],
  发布页地址: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  图文发布页地址: 'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image',
  文章发布页地址: 'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=article',
  文章入口按钮: 'button:has-text("新的创作")',
  匹配域名: ['creator.xiaohongshu.com'],
  就绪选择器: '.upload-wrapper, input[placeholder*="标题"]',
  文章就绪选择器: 'textarea[placeholder*="输入标题"], .tiptap.ProseMirror',
  上传: {
    上传容器: '.upload-wrapper',
    文件输入框: [
      '.upload-wrapper input[type="file"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记: '.upload-wrapper video, [class*="upload"] video, .upload-wrapper [class*="preview"]',
    编辑器就绪标记: '.d-input-wrapper.c-input_inner, .d-input-wrapper, [class*="c-input_inner"]',
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
    编辑器就绪标记: '.d-input-wrapper.c-input_inner, .d-input-wrapper, [class*="c-input_inner"]',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: '.d-input-wrapper.c-input_inner, .d-input-wrapper, [class*="c-input_inner"]',
    简介: '.editor-content',
    文章正文: '.tiptap.ProseMirror, [contenteditable="true"]',
    封面:
      '.publish-page-content-cover .default.row, .publish-page-content-cover .cover-plugin-preview, .publish-page-content-cover',
    声明: {
      触发器: '.d-switch-box',
      类型: 'toggle',
    },
    谁可以看: {
      触发器: '.d-text.d-text-nowrap.d-select-description',
      类型: 'dropdown',
    },
    定时发布: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
      时间输入: '.d-datepicker-input-filter input, .date-picker-container input',
    },
    原创声明: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
    },
  },
  图文字段: {
    标题: 'input[placeholder*="标题"], .d-input-wrapper.c-input_inner',
    简介: '.tiptap.ProseMirror, [contenteditable="true"]',
    封面:
      '.publish-page-content-cover .default.row, .publish-page-content-cover .cover-plugin-preview, .publish-page-content-cover',
    声明: {
      触发器: '.d-switch-box',
      类型: 'toggle',
    },
    谁可以看: {
      触发器: '.d-text.d-text-nowrap.d-select-description',
      类型: 'dropdown',
    },
    定时发布: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
      时间输入: '.d-datepicker-input-filter input, .date-picker-container input',
    },
    原创声明: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
    },
  },
  文章字段: {
    标题: 'textarea[placeholder*="输入标题"]',
    标题填充方式: 'inputValue',
    简介: '.tiptap.ProseMirror[contenteditable="true"]',
    文章正文: '.tiptap.ProseMirror[contenteditable="true"]',
    声明: {
      触发器: '.d-switch-box',
      类型: 'toggle',
    },
    谁可以看: {
      触发器: '.d-text.d-text-nowrap.d-select-description',
      类型: 'dropdown',
    },
    定时发布: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
      时间输入: '.d-datepicker-input-filter input, .date-picker-container input',
    },
    原创声明: {
      触发器: '.custom-switch-card .custom-switch-icon, .custom-switch-icon',
      类型: 'switch',
    },
  },
} satisfies PlatformSelectorConfig;
