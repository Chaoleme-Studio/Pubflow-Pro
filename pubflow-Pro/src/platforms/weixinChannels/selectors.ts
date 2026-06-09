import type { PlatformSelectorConfig } from '../types';

export const weixinChannelsSelectorConfig = {
  平台标识: 'weixinChannels',
  名称: '视频号',
  图标: 'WX',
  支持内容类型: ['video', 'image'],
  发布页地址: 'https://channels.weixin.qq.com/platform/post/create',
  图文发布页地址: 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate',
  匹配域名: ['channels.weixin.qq.com'],
  就绪选择器:
    '.ant-upload.ant-upload-drag, .ant-upload-drag-container, .post-upload-wrap input[type="file"][accept*="video"]',
  上传: {
    上传容器: '.ant-upload.ant-upload-drag, .ant-upload-drag-container, .post-upload-wrap, .upload-wrap',
    拖拽容器: ['.ant-upload-drag-container', '.ant-upload.ant-upload-drag', '.ant-upload-btn'],
    文件输入框: [
      '.post-upload-wrap .ant-upload input[type="file"][accept*="video"]',
      '.ant-upload input[type="file"]',
      '.post-upload-wrap input[type="file"]',
      '.ant-upload input[type="file"][accept*="video"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记:
      '.form-btns .weui-desktop-btn_primary:not(.weui-desktop-btn_disabled), .form-btns .weui-desktop-btn_default:not(.weui-desktop-btn_disabled), div.media-status-content div.tag-inner',
    编辑器就绪标记: 'div.input-editor',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  图文上传: {
    上传容器: '.ant-upload, [class*="upload"], [class*="Upload"]',
    文件输入框: [
      'input[type="file"][accept*="image"]',
      '.ant-upload input[type="file"]',
      'input[type="file"]',
    ],
    上传完成标记: '[class*="image-preview"], [class*="upload-success"], [class*="image-list"]',
    编辑器就绪标记: 'div.input-editor',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: 'div.input-editor',
    简介: 'div.input-editor',
    话题: 'div.input-editor',
    封面: '.vertical-cover-wrap, .horizon-cover-wrap, .cover-preview-wrap',
    声明: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
    },
    定时发布: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
    },
    原创声明: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
    },
  },
  图文字段: {
    标题: 'input[placeholder*="标题"]',
    简介: 'div.input-editor',
    话题: 'div.input-editor',
    封面: '.vertical-cover-wrap, .horizon-cover-wrap, .cover-preview-wrap',
    声明: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
    },
    定时发布: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
    },
    原创声明: {
      触发器: 'input[type="checkbox"]',
      类型: 'checkbox',
    },
  },
} satisfies PlatformSelectorConfig;
