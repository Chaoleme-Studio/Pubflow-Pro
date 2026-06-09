import type { PlatformSelectorConfig } from '../types';

export const bilibiliSelectorConfig = {
  平台标识: 'bilibili',
  名称: 'B站',
  图标: 'BILI',
  发布页地址: 'https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload',
  文章发布页地址: 'https://member.bilibili.com/platform/upload/text/new-edit',
  匹配域名: ['member.bilibili.com'],
  就绪选择器: '.bcc-upload.upload, .bcc-upload, .upload',
  文章就绪选择器: '[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]',
  上传: {
    上传容器: '.bcc-upload.upload',
    文件输入框: [
      '.bcc-upload input[type="file"]',
      '.upload input[type="file"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记: '.bcc-upload video, [class*="upload"] video, [class*="video-cover"]',
    编辑器就绪标记: '.video-title-content',
    需要激活标签页: true,
    超时毫秒: 240000,
  },
  字段: {
    标题: '.video-title-content',
    标题填充方式: 'contentEditable',
    简介: '.archive-info-editor',
    文章正文: '[contenteditable="true"][role="textbox"], div[contenteditable="true"], .ProseMirror',
    话题: 'input[placeholder*="标签"], input[placeholder*="话题"]',
    声明: {
      触发器: 'input.bcc-select-input-inner[placeholder*="创作声明"]',
      类型: 'dropdown',
    },
    分类: {
      触发器: '.type-check-radio-wrp',
      接口地址: 'https://member.bilibili.com/x/vupre/web/archive/human/type2/list',
    },
    标签: '#tag-container input.input-val, input[placeholder*="创建标签"]',
    封面: '.cover-img, .edit-text, .cover, .cover-content, .cover-settings, .bcc-cover-settings, [class*="cover-setting"], [class*="coverSetting"], .cover-crop',
    谁可以看: {
      触发器: 'span.check-radio-v2-name',
      类型: 'radio',
    },
    定时发布: {
      触发器: '.time-switch-wrp .switch-container, .time-switch-wrp .switch-roll',
      类型: 'switch',
      时间输入: '.date-picker-timer',
    },
    原创声明: {
      触发器: 'input.bcc-select-input-inner[placeholder*="创作声明"]',
      类型: 'dropdown',
      选项文本: '内容无需标注',
    },
  },
  文章字段: {
    标题:
      'textarea.title-input__inner, [class*="title"] textarea, [class*="Title"] textarea, textarea[placeholder*="标题"], input[placeholder*="标题"], [data-placeholder*="标题"]',
    标题填充方式: 'inputValue',
    简介: '[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]',
    文章正文:
      '[contenteditable="true"][role="textbox"]:not([class*="title"]):not([class*="Title"]), .ProseMirror[contenteditable="true"]',
    封面: '[class*="cover"], [class*="Cover"], [class*="upload-cover"], [class*="UploadCover"], input[type="file"][accept*="image"]',
    定时发布: {
      触发器: '[class*="time"], [class*="Time"], [class*="schedule"], [class*="Schedule"], input[type="checkbox"]',
      类型: 'switch',
      时间输入:
        'input[placeholder*="时间"], input[placeholder*="日期"], .date-time-picker, .date-input, .time-input, .date-picker-timer, [class*="time"] input',
    },
    话题: 'button:has-text("添加话题")',
    声明: {
      触发器: 'button:has-text("添加话题")',
      类型: 'button',
    },
  },
} satisfies PlatformSelectorConfig;
