import type { PlatformSelectorConfig } from '../types';

export const youtubeSelectorConfig = {
  平台标识: 'youtube',
  名称: 'YouTube',
  图标: 'YT',
  支持内容类型: ['video'],
  // `/channel/<channelId>/videos/upload?d=ud` 可直达弹窗，但 channelId 因用户而异。
  // 公共入口保持 Studio 根地址，由 content.ts 优先直点“上传视频”，必要时回退“创建 → 上传视频”。
  发布页地址: 'https://studio.youtube.com/',
  匹配域名: ['studio.youtube.com'],
  检测通用弹窗: false,
  就绪选择器: 'ytcp-app, ytcp-button#create-icon, #create-icon, input[type="file"][accept*="video"], ytcp-uploads-dialog',
  上传: {
    上传容器: 'ytcp-uploads-dialog, ytcp-uploads-file-picker, ytcp-app',
    文件输入框: [
      // 2026-07 实测上传弹窗的 input.accept 为空，优先使用组件范围定位。
      'ytcp-uploads-file-picker input[type="file"]',
      'input#content-uploader-file-input',
      'input[type="file"][accept*="video"]',
    ],
    上传完成标记: 'ytcp-video-metadata-editor-basics, ytcp-uploads-dialog #details',
    编辑器就绪标记: 'ytcp-social-suggestions-textbox#title-textarea, #title-textarea',
    超时毫秒: 300000,
    需要激活标签页: true,
  },
  字段: {
    标题: 'ytcp-social-suggestions-textbox#title-textarea, #title-textarea',
    标题填充方式: 'contentEditable',
    简介: 'ytcp-social-suggestions-textbox#description-textarea, #description-textarea',
    封面: 'ytcp-thumbnails-compact-editor-uploader, #custom-thumbnail-uploader',
  },
} satisfies PlatformSelectorConfig;
