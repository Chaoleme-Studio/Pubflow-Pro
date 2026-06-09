import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';
import { PLATFORM_MATCH_PATTERNS } from './src/platforms';
import { obfuscate, type ObfuscatorOptions } from 'javascript-obfuscator';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG = {
  ...readLocalConfig(resolve(ROOT_DIR, '.env')),
  ...process.env,
};
const DEV_WORKSPACE_PATH = normalizeLocalPath(LOCAL_CONFIG.PUBFLOW_DEV_WORKSPACE_PATH) || '';
const CHROMIUM_PORT = Number(LOCAL_CONFIG.PUBFLOW_CHROMIUM_PORT?.trim() || '9222') || 9222;
const CHROMIUM_PROFILE = normalizeLocalPath(LOCAL_CONFIG.PUBFLOW_CHROMIUM_PROFILE);
const MANUAL_BROWSER = parseBooleanEnv(LOCAL_CONFIG.PUBFLOW_MANUAL_BROWSER);
const USE_EXISTING_CHROMIUM = parseBooleanEnv(LOCAL_CONFIG.PUBFLOW_USE_EXISTING_CHROMIUM);
const OBFUSCATE = parseBooleanEnv(LOCAL_CONFIG.OBFUSCATE);

if (CHROMIUM_PROFILE) {
  mkdirSync(CHROMIUM_PROFILE, { recursive: true });
}

// AI 设置页当前只会访问这些 OpenAI Compatible 接口的 /models。
const AI_PROVIDER_HOST_PERMISSIONS = [
  'https://api.openai.com/*',
  'https://api.deepseek.com/*',
  'https://dashscope.aliyuncs.com/*',
  'https://api.siliconflow.cn/*',
  'https://api.xiaomimimo.com/*',
];

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [
      patchMarkstreamCss(),
      tailwindcss(),
      ...(OBFUSCATE ? [protectExtensionRuntimeChunks()] : []),
    ],
    define: {
      // 仅开发环境使用，用于在设置页展示预设工作区路径。
      __PUBFLOW_DEV_WORKSPACE_PATH__: JSON.stringify(DEV_WORKSPACE_PATH),
    },
  }),
  webExt: {
    // PUBFLOW_MANUAL_BROWSER=1 时只启动 WXT dev server 并输出 .output/chrome-mv3-dev，
    // 不让 WXT/web-ext 连接 9222 或自动 loadUnpacked；浏览器由用户手动启动和加载扩展。
    disabled: MANUAL_BROWSER,
    // 普通 pnpm dev 应该由 WXT 自己启动浏览器。
    // 只有显式设置 PUBFLOW_USE_EXISTING_CHROMIUM=1 时，才让 web-ext 连接已有 9222 Chrome。
    // 否则 .env 里的 9222/profile 会导致 WXT 去控制手动 Chrome，触发
    // “CDP connection closed before response to Extensions.loadUnpacked”。
    ...(USE_EXISTING_CHROMIUM
      ? {
          chromiumPort: CHROMIUM_PORT,
          chromiumProfile: CHROMIUM_PROFILE,
          keepProfileChanges: true,
        }
      : {}),
    chromiumArgs: ['--remote-allow-origins=*'],
    startUrls: ['chrome://extensions/'],
  },
  manifest: {
    name: 'PubFlow 多平台短视频发布助手',
    short_name: 'PubFlow',
    description: '打开平台发布页后先检测阻挡，由用户确认后按拟真人节奏填充标题、描述和话题。',
    version: '0.1.0',
    permissions: ['storage', 'unlimitedStorage', 'tabs', 'activeTab', 'sidePanel', 'scripting', 'debugger'],
    // 平台页面注入 + AI 接口访问都依赖这里的 host 权限。
    host_permissions: [...PLATFORM_MATCH_PATTERNS, ...AI_PROVIDER_HOST_PERMISSIONS],
    action: {
      default_title: 'PubFlow',
    },
    web_accessible_resources: [
      {
        resources: ['dashboard.html'],
        matches: ['<all_urls>'],
      },
    ],
  },
});

function readLocalConfig(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const config: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      config[key] = value;
    }
  }

  return config;
}

function parseBooleanEnv(rawValue?: string): boolean {
  if (!rawValue) return false;
  return ['1', 'true', 'yes', 'on'].indexOf(rawValue.trim().toLowerCase()) >= 0;
}

function normalizeLocalPath(rawPath?: string): string | undefined {
  if (!rawPath) return undefined;

  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  return unquoted
    .replace(/\$HOME(?=\/|\\|$)/g, homedir())
    .replace(/^~(?=\/|\\|$)/, homedir());
}

function patchMarkstreamCss() {
  return {
    name: 'patch-markstream-css',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('markstream-vue/dist/index.css')) return null;
      if (!code.includes(':deep(svg)')) return null;
      return {
        code: code.replace('.icon-slot :deep(svg)', '.icon-slot svg'),
        map: null,
      };
    },
  };
}

function protectExtensionRuntimeChunks() {
  const protectedRuntimeChunkPattern = /^(background\.js|content-scripts\/content\.js)$/;
  const projectRoot = `${toBuildPath(ROOT_DIR)}/`;
  const projectSourceRoots = [`${projectRoot}src/`, `${projectRoot}entrypoints/`];
  const options: ObfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 1,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  };

  return {
    name: 'protect-extension-runtime-chunks',
    renderChunk(code: string, chunk: { fileName: string; moduleIds?: string[] }) {
      // 只在 Rollup 已经完成模块解析和动态 import 拆包后混淆最终 chunk。
      // 不能在 transform 阶段混淆源码，否则 `import('./views/*.vue')` 会被改写，
      // Rollup 无法再生成 Dashboard/Records/Settings 等异步页面 chunk，发布 ZIP 会只剩页面头部。
      if (!shouldProtectChunk(chunk)) return null;

      const result = obfuscate(code, {
        ...options,
        inputFileName: chunk.fileName,
        // 发布包不需要 sourcemap；这里显式关闭，避免产物带出源码映射。
        sourceMap: false,
      });

      return {
        code: result.getObfuscatedCode(),
        map: null,
      };
    },
  };

  function shouldProtectChunk(chunk: { fileName: string; moduleIds?: string[] }): boolean {
    // background/content 是扩展自动化的核心逻辑，文件名稳定，始终保护。
    if (protectedRuntimeChunkPattern.test(chunk.fileName)) return true;

    // dashboard、sidepanel、各页面 view 和平台配置都会被 Rollup 拆到 chunks 下。
    // 只保护包含本项目源码的 chunk，跳过纯第三方库（Vue/Highcharts/markstream 等），
    // 保留构建速度并降低第三方库被混淆后出现运行时兼容问题的概率。
    if (!chunk.fileName.startsWith('chunks/') || !chunk.fileName.endsWith('.js')) return false;

    return (chunk.moduleIds || []).some((id) => {
      const modulePath = toBuildPath(id.split('?')[0] || id);
      return projectSourceRoots.some((sourceRoot) => modulePath.startsWith(sourceRoot));
    });
  }
}

function toBuildPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}
