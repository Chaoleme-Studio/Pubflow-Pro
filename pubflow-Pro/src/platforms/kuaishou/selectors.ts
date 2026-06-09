import type { PlatformSelectorConfig } from '../types';

export const kuaishouSelectorConfig = {
  平台标识: 'kuaishou',
  名称: '快手',
  图标: 'KS',
  支持内容类型: ['video', 'image'],
  发布页地址: 'https://cp.kuaishou.com/article/publish/video?tabType=1',
  图文发布页地址: 'https://cp.kuaishou.com/article/publish/video?tabType=2',
  匹配域名: ['creator.kuaishou.com', 'cp.kuaishou.com'],
  就绪选择器: '._dragger-content_1j3uy_39, [class*="dragger-content"]',
  上传: {
    上传容器: '._dragger-content_1j3uy_39, [class*="dragger-content"]',
    文件输入框: [
      '._dragger-content_1j3uy_39 input[type="file"]',
      '[class*="dragger-content"] input[type="file"]',
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    上传完成标记: '[class*="dragger-content"] video, [class*="upload"] video',
    编辑器就绪标记: '._edit-desc-container_17g9x_7, [class*="edit-desc-container"]',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  图文上传: {
    上传容器: '._upload-container_ysbff_12, [class*="upload-container_ysbff"]',
    拖拽容器: ['._dragger-content_ysbff_19, [class*="dragger-content_ysbff"]'],
    上传按钮: ['._upload-btn_ysbff_57, [class*="upload-btn_ysbff"]'],
    文件输入框: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    上传完成标记: '[class*="upload-item"], [class*="image-preview"]',
    编辑器就绪标记: '[class*="edit-desc-container"], [contenteditable="true"]',
    超时毫秒: 180000,
    需要激活标签页: true,
  },
  字段: {
    标题: '',
    简介: '._edit-desc-container_17g9x_7, [class*="edit-desc-container"]',
    封面: '._high-cover-editor_ps02t_1, [class*="cover-editor"], ._default-cover_ps02t_86, [class*="default-cover"]',
    谁可以看: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
    },
    定时发布: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
      时间输入: 'input[placeholder="选择日期时间"]',
    },
  },
  图文字段: {
    标题: '',
    简介: '[class*="edit-desc-container"], [class*="description"][contenteditable="true"], [contenteditable="true"]',
    封面: '._high-cover-editor_ps02t_1, [class*="cover-editor"], ._default-cover_ps02t_86, [class*="default-cover"]',
    谁可以看: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
    },
    定时发布: {
      触发器: 'input[type="radio"]',
      类型: 'radio',
      时间输入: 'input[placeholder="选择日期时间"]',
    },
  },
} satisfies PlatformSelectorConfig;
