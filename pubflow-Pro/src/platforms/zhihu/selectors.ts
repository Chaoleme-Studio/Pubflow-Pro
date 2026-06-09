import type { PlatformSelectorConfig } from '../types';

export const zhihuSelectorConfig = {
  平台标识: 'zhihu',
  名称: '知乎',
  图标: 'ZH',
  发布页地址: 'https://www.zhihu.com/upload-video?entry=navPanel',
  文章发布页地址: 'https://zhuanlan.zhihu.com/write',
  匹配域名: ['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'],
  就绪选择器:
    '.VideoUploadButton, .VideoUploadHint-button, .TitleArea, .EditorArea, [class*="VideoUploadForm"]',
  文章就绪选择器: 'textarea[placeholder*="标题"], .public-DraftEditor-content',
  上传: {
    上传容器: '.VideoUploadHint, [class*="VideoUploadHint"]',
    上传按钮: [
      '.css-12hibeq',
      '.VideoUploadHint-buttonGroup .css-12hibeq',
      '[class*="VideoUploadHint"] [class*="css-12hibeq"]',
      '.Button.VideoUploadButton.VideoUploadHint-button',
      '.VideoUploadButton',
      '.VideoUploadHint-button',
      '[class*="VideoUploadButton"]',
      '[class*="VideoUploadHint-button"]',
    ],
    文件输入框: [
      'input.VideoUploadButton-fileInput',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记: '.TitleArea, .EditorArea',
    编辑器就绪标记: '.TitleArea',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: '.TitleArea',
    简介: '.EditorArea',
    文章正文: '.EditorArea, div[contenteditable="true"], .WriteIndex-content [contenteditable="true"]',
    封面: '.VideoUploadForm-imageEditButton, [class*="VideoUploadForm-imageEditButton"]',
    声明: {
      触发器: 'button[role="combobox"], .VideoUploadForm-videoTypeModalOption',
      类型: 'dropdown',
      选项文本: '内容无需标注',
    },
    定时发布: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
      时间输入: 'button[role="combobox"]',
    },
  },
  文章字段: {
    标题: 'textarea[placeholder*="标题"]',
    标题填充方式: 'inputValue',
    简介: '.public-DraftEditor-content[contenteditable="true"]',
    文章正文: '.public-DraftEditor-content[contenteditable="true"]',
    封面: '.UploadPicture-input, .UploadPicture-wrapper, [class*="UploadPicture"]',
  },
} satisfies PlatformSelectorConfig;
