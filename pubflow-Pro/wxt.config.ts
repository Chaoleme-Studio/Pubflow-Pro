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
const PACKAGE_VERSION = JSON.parse(readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8')).version;
const WORKSPACE_DIR = resolve(ROOT_DIR, '..');
// 公钥不是密钥；固定它可让 dist 与 .output 的 unpacked 产物使用同一个扩展 ID。
// 对应的 CRX 私钥由发布环境保管，不进入源码。
const EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyJfKJlFaT3wwk0H8D1ZyVdiIo02mSk4sxVlQfnQP1NIQqpSg24dtImxO0sKtUPzfJsv9pSASnF2vFLc3C2pmj2CXzkE5xeVasrw6rN0w0/D6bMJTf9hv5O1SW7882tWVXm+Cz5b+kFVe+unmDAT3dVvTB4Ca1gVaB8a0oMDxSgP+/AZfnV7/bdsbh6CyeOL5IZ8SFOvGzSo4OH4nkFLKJV1X1cjsyC9xGds8K121mlDn6xbtYgwzGqlEvJlv7zRiKiRAwVFuQbPMlxJGUZTCFmRxRW2ED5KiV9kg6uD7Ij4EdNHQ7OaMxBRdB33MWnXD6KVjr6VX7PluiOnhZw0hhQIDAQAB';
const WXT_COMMAND = process.argv.includes('build') || process.argv.includes('zip') ? 'production' : 'development';
const ENV_NAME = process.env.PUBFLOW_ENV || process.env.ENV || WXT_COMMAND;
const LOCAL_CONFIG = deriveLocalConfig({
  ...readLocalConfig(resolve(WORKSPACE_DIR, `.env.${ENV_NAME}`)),
  ...process.env,
});
const DEV_WORKSPACE_PATH = normalizeLocalPath(
  LOCAL_CONFIG.PUBFLOW_DEV_WORKSPACE_PATH || LOCAL_CONFIG.PUBFLOW_WORKSPACE,
) || '';
const DEFAULT_TOPIC_INTERVAL_MS = requireIntegerConfig(LOCAL_CONFIG, 'PUBFLOW_TOPIC_INTERVAL_MS', 100, 3000);
const AGENT_PORT = optionalIntegerConfig(LOCAL_CONFIG, 'PUBFLOW_AGENT_PORT', 5190, 1, 65_535);
const DEFAULT_AGENT_WS_URL = `ws://127.0.0.1:${AGENT_PORT}/v1/extension/ws`;
const CHROMIUM_PORT = Number(LOCAL_CONFIG.PUBFLOW_CHROMIUM_PORT?.trim() || '9222') || 9222;
const CHROMIUM_PROFILE = normalizeLocalPath(LOCAL_CONFIG.PUBFLOW_CHROMIUM_PROFILE);
const MANUAL_BROWSER = parseBooleanEnv(LOCAL_CONFIG.PUBFLOW_MANUAL_BROWSER);
const USE_EXISTING_CHROMIUM = parseBooleanEnv(LOCAL_CONFIG.PUBFLOW_USE_EXISTING_CHROMIUM);
const OBFUSCATE = parseBooleanEnv(LOCAL_CONFIG.OBFUSCATE);
const OBFUSCATE_LICENSE_UI = parseBooleanEnv(LOCAL_CONFIG.OBFUSCATE_LICENSE_UI);
const DEFAULT_LICENSE_API_BASE_URL = (LOCAL_CONFIG.PUBFLOW_LICENSE_API_BASE_URL || LOCAL_CONFIG.PUBLIC_API_BASE_URL || '').trim();
const OFFICIAL_SITE_URL = (LOCAL_CONFIG.PUBFLOW_OFFICIAL_SITE_URL || DEFAULT_LICENSE_API_BASE_URL || '').trim();
const PROTOCOL_PUBLIC_KEY = normalizeHexKey(LOCAL_CONFIG.PUBFLOW_PROTOCOL_PUBLIC_KEY);
const PROTOCOL_TRUST_ROOT_P256_SPKI = normalizeBase64UrlKey(LOCAL_CONFIG.PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI);
const LICENSE_API_HOST_PERMISSION = toHostPermission(DEFAULT_LICENSE_API_BASE_URL);
const SERIALIZABLE_PAGE_WORLD_FUNCTIONS = [
  'injectDouyinCover',
  'injectDouyinArticleCover',
  'runWeixinChannelsPageWorldAction',
];

if (OBFUSCATE && isRemoteUrl(DEFAULT_LICENSE_API_BASE_URL) && !PROTOCOL_PUBLIC_KEY) {
  throw new Error('Protected remote builds require PUBFLOW_PROTOCOL_PUBLIC_KEY');
}

if (CHROMIUM_PROFILE) {
  mkdirSync(CHROMIUM_PROFILE, { recursive: true });
}

// AI 设置页会访问 OpenAI Compatible 接口的 /models 和 /chat/completions。
// 预设域名用于清晰提示，HTTPS 通配兜底给自建中转、One API/New API、Worker 网关。
const AI_PROVIDER_HOST_PERMISSIONS = [
  'https://api.openai.com/*',
  'https://api.deepseek.com/*',
  'https://dashscope.aliyuncs.com/*',
  'https://api.siliconflow.cn/*',
  'https://api.xiaomimimo.com/*',
  'https://*/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
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
      __PUBFLOW_DEFAULT_TOPIC_INTERVAL_MS__: JSON.stringify(DEFAULT_TOPIC_INTERVAL_MS),
      __PUBFLOW_DEFAULT_AGENT_WS_URL__: JSON.stringify(DEFAULT_AGENT_WS_URL),
      __PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__: JSON.stringify(DEFAULT_LICENSE_API_BASE_URL),
      __PUBFLOW_OFFICIAL_SITE_URL__: JSON.stringify(OFFICIAL_SITE_URL),
      __PUBFLOW_PROTOCOL_PUBLIC_KEY__: JSON.stringify(PROTOCOL_PUBLIC_KEY),
      __PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI__: JSON.stringify(PROTOCOL_TRUST_ROOT_P256_SPKI),
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
    key: EXTENSION_PUBLIC_KEY,
    name: 'PubFlow 多平台短视频发布助手',
    short_name: 'PubFlow',
    description: '打开平台发布页后先检测阻挡，由用户确认后按拟真人节奏填充标题、描述和话题。',
    version: PACKAGE_VERSION,
    minimum_chrome_version: '116',
    permissions: ['storage', 'unlimitedStorage', 'tabs', 'activeTab', 'sidePanel', 'scripting', 'debugger', 'notifications', 'alarms'],
    // 平台页面注入 + AI 接口访问都依赖这里的 host 权限。
    host_permissions: [
      ...PLATFORM_MATCH_PATTERNS,
      ...AI_PROVIDER_HOST_PERMISSIONS,
      ...(LICENSE_API_HOST_PERMISSION ? [LICENSE_API_HOST_PERMISSION] : []),
    ],
    action: {
      default_title: 'PubFlow',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
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

function deriveLocalConfig(config: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {};
  Object.entries(config).forEach(([key, value]) => {
    if (typeof value === 'string') next[key] = value;
  });
  if (next.PUBLIC_API_BASE_URL && !next.PUBFLOW_LICENSE_API_BASE_URL) {
    next.PUBFLOW_LICENSE_API_BASE_URL = next.PUBLIC_API_BASE_URL;
  }
  return next;
}

function parseBooleanEnv(rawValue?: string): boolean {
  if (!rawValue) return false;
  return ['1', 'true', 'yes', 'on'].indexOf(rawValue.trim().toLowerCase()) >= 0;
}

function requireIntegerConfig(
  config: Record<string, string>,
  key: string,
  min: number,
  max: number,
) {
  const rawValue = config[key]?.trim();
  const value = Number(rawValue);
  if (!rawValue || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalIntegerConfig(
  config: Record<string, string>,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const rawValue = config[key]?.trim();
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
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

function toHostPermission(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return '';
  }
}

function normalizeHexKey(rawValue?: string): string {
  const value = (rawValue || '').trim().toLowerCase();
  if (!value) return '';
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('PUBFLOW_PROTOCOL_PUBLIC_KEY must be a 32-byte hex string');
  }
  return value;
}

function normalizeBase64UrlKey(rawValue?: string): string {
  const value = (rawValue || '').trim();
  if (!value) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI must be base64url without padding');
  }
  return value;
}

function isRemoteUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
  } catch {
    return false;
  }
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
  const runtimeOptions: ObfuscatorOptions = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    splitStrings: true,
    splitStringsChunkLength: 16,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  };
  const licenseUiOptions: ObfuscatorOptions = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.35,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  };

  return {
    name: 'protect-extension-runtime-chunks',
    renderChunk(code: string, chunk: { fileName: string; moduleIds?: string[] }) {
      // 只在 Rollup 已经完成模块解析和动态 import 拆包后混淆最终 chunk。
      // 不能在 transform 阶段混淆源码，否则 `import('./views/*.vue')` 会被改写，
      // Rollup 无法再生成 Dashboard/Records/Settings 等异步页面 chunk，发布 ZIP 会只剩页面头部。
      const options = protectionOptionsForChunk(chunk);
      if (!options) return null;

      const sourceCode = protectedRuntimeChunkPattern.test(chunk.fileName)
        ? preserveSerializablePageWorldFunctions(code)
        : code;
      const result = obfuscate(sourceCode, {
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

  function protectionOptionsForChunk(chunk: { fileName: string; moduleIds?: string[] }): ObfuscatorOptions | null {
    if (protectedRuntimeChunkPattern.test(chunk.fileName)) {
      return runtimeOptions;
    }
    if (OBFUSCATE_LICENSE_UI && isLicenseUiChunk(chunk)) {
      return licenseUiOptions;
    }
    return null;
  }

  function isLicenseUiChunk(chunk: { fileName: string; moduleIds?: string[] }): boolean {
    if (/^chunks\/(SettingsView|dashboard)-/.test(chunk.fileName)) {
      return true;
    }
    const moduleIds = chunk.moduleIds || [];
    return moduleIds.some((id) => {
      const normalized = id.split('\\').join('/');
      return normalized.includes('/entrypoints/dashboard/views/SettingsView.vue')
        || normalized.includes('/src/licensing/');
    });
  }
}

function preserveSerializablePageWorldFunctions(code: string): string {
  const ranges = SERIALIZABLE_PAGE_WORLD_FUNCTIONS
    .map((functionName) => findFunctionDeclarationRange(code, functionName))
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((a, b) => b.start - a.start);

  let next = code;
  for (const range of ranges) {
    next = `${next.slice(0, range.start)}\n// javascript-obfuscator:disable\n${next.slice(range.start, range.end)}\n// javascript-obfuscator:enable\n${next.slice(range.end)}`;
  }
  return next;
}

function findFunctionDeclarationRange(code: string, functionName: string): { start: number; end: number } | null {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:async\\s+)?function\\s+${escapedName}\\s*\\(`).exec(code);
  if (!match) return null;

  const bodyStart = code.indexOf('{', match.index + match[0].length);
  if (bodyStart < 0) return null;

  const bodyEnd = findMatchingBrace(code, bodyStart);
  if (bodyEnd < 0) return null;
  return { start: match.index, end: bodyEnd + 1 };
}

function findMatchingBrace(code: string, openBraceIndex: number): number {
  let depth = 0;
  let quote: '"' | '\'' | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openBraceIndex; i < code.length; i += 1) {
    const char = code[i];
    const next = code[i + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
