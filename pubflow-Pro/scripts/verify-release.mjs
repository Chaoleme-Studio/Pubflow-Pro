import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[i + 1]?.startsWith('--') ? '1' : process.argv[i + 1] || '1');
    if (args.get(arg) !== '1') i += 1;
  }
}

const distDir = resolve(rootDir, args.get('--dir') || '.output/chrome-mv3');
const requireObfuscation = args.get('--allow-unprotected') !== '1';
const packageJson = readJson('package.json');
const failures = [];
const warnings = [];
const serializablePageWorldFunctions = [
  {
    label: 'injectDouyinCover',
    anchor: '.semi-upload',
    markers: ['.semi-upload', '__reactFiber', 'notifyFileSelect', 'handleChange'],
  },
  {
    label: 'injectDouyinArticleCover',
    anchor: 'HTMLInputElement.prototype.click',
    markers: ['HTMLInputElement.prototype.click', '替换封面', '.webp', 'new DataTransfer'],
  },
  {
    label: 'runWeixinChannelsPageWorldAction',
    anchor: '__pubflowWeixinImageUploadState',
    markers: [
      '__pubflowWeixinImageUploadState',
      '页面主世界未找到 div.input-editor',
      '页面主世界未找到视频上传 input',
      '页面主世界未找到图片上传 input',
      '页面主世界未找到短标题输入框',
    ],
  },
];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(rootDir, relativePath), 'utf8'));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function collectFiles(dir) {
  const result = [];
  for (const name of readdirSync(dir)) {
    const filePath = resolve(dir, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      result.push(...collectFiles(filePath));
    } else {
      result.push(filePath);
    }
  }
  return result;
}

function rel(filePath) {
  return relative(rootDir, filePath).split(sep).join('/');
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readEnv() {
  const envPath = resolve(rootDir, '.env');
  const parsed = {};
  if (!existsSync(envPath)) return parsed;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function isRemoteUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseBooleanEnv(rawValue) {
  if (!rawValue) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
}

function assertExists(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} 不存在：${rel(filePath)}`);
    return false;
  }
  return true;
}

function assertObfuscated(filePath, label) {
  if (!assertExists(filePath, label)) return;
  const code = readText(filePath);
  if (code.includes('sourceMappingURL=')) {
    fail(`${label} 包含 sourceMappingURL`);
  }
  if (!requireObfuscation) return;
  if (!/function _0x[0-9a-fA-F]+/.test(code) || !/_0x[0-9a-fA-F]+\(/.test(code)) {
    fail(`${label} 未呈现 javascript-obfuscator 的典型结构`);
  }
  if (/\bfrom ['"][../]/.test(code) || /\bimport\s+/.test(code.slice(0, 2000))) {
    fail(`${label} 看起来仍保留源码级 import`);
  }
}

function findMatchingBrace(code, openBraceIndex) {
  let depth = 0;
  let quote = null;
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

function findFunctionSourceContainingMarkers(code, markers) {
  const markerIndexes = markers.map((marker) => code.indexOf(marker));
  if (markerIndexes.some((index) => index < 0)) return '';

  let best = '';
  for (const match of code.matchAll(/(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g)) {
    const bodyStart = code.indexOf('{', match.index + match[0].length);
    if (bodyStart < 0) continue;

    const bodyEnd = findMatchingBrace(code, bodyStart);
    if (bodyEnd < 0) continue;

    if (markerIndexes.every((index) => index >= match.index && index <= bodyEnd)) {
      const source = code.slice(match.index, bodyEnd + 1);
      if (!best || source.length < best.length) {
        best = source;
      }
    }
  }

  return best;
}

function assertSerializablePageWorldFunctions(backgroundCode) {
  for (const { label, markers } of serializablePageWorldFunctions) {
    const source = findFunctionSourceContainingMarkers(backgroundCode, markers);
    if (!source) {
      fail(`background.js 缺少 MAIN world 注入函数体：${label}`);
      continue;
    }

    if (/\b_0x[0-9a-fA-F]+\s*\(/.test(source)) {
      fail(`${label} 被混淆成依赖外部 helper 的函数，chrome.scripting.executeScript({ func }) 注入后会失效`);
    }

    for (const marker of markers) {
      if (!source.includes(marker)) {
        fail(`${label} 缺少自包含标记 ${marker}，可能被混淆或拆到函数外`);
      }
    }
  }
}

function assertReleaseVersion() {
  const version = String(packageJson.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`package version 不是有效的 SemVer：${version || 'empty'}`);
    return;
  }

  const changelogPath = resolve(rootDir, '../CHANGELOG.md');
  if (assertExists(changelogPath, '根目录 CHANGELOG.md')) {
    const changelog = readText(changelogPath);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
      fail(`CHANGELOG.md 缺少当前版本标题：## [${version}] - YYYY-MM-DD`);
    }
  }

  const releaseTag = String(args.get('--tag') || process.env.GITHUB_REF_NAME || '').trim();
  if (releaseTag && releaseTag !== `v${version}`) {
    fail(`Git tag ${releaseTag} 与 package version ${version} 不一致（期望 v${version}）`);
  }
}

assertReleaseVersion();

if (!existsSync(distDir)) {
  fail(`发布目录不存在：${distDir}`);
} else {
  const manifestPath = resolve(distDir, 'manifest.json');
  if (assertExists(manifestPath, 'manifest.json')) {
    const manifest = JSON.parse(readText(manifestPath));
    if (manifest.manifest_version !== 3) fail('manifest_version 不是 3');
    if (manifest.version !== packageJson.version) {
      fail(`manifest version ${manifest.version} 与 package version ${packageJson.version} 不一致`);
    }
    if (!manifest.content_security_policy?.extension_pages?.includes("'wasm-unsafe-eval'")) {
      fail('manifest CSP 缺少 wasm-unsafe-eval，WASM 可能无法加载');
    }
  }

  const files = collectFiles(distDir);
  const relativeFiles = files.map(rel);
  for (const filePath of files) {
    const name = rel(filePath);
    const ext = extname(filePath);
    if (ext === '.map') fail(`发布产物包含 sourcemap：${name}`);
    if (/\.(ts|tsx|vue|md)$/i.test(name)) fail(`发布产物包含源码/文档文件：${name}`);
    if (/(^|\/)(__tests__|test|tests|spec|_doc|docs|secrets|tmp|temp)(\/|$)/i.test(name)) {
      fail(`发布产物包含测试/内部/临时目录：${name}`);
    }
    if (/sourceMappingURL=/.test(readFileSync(filePath, 'utf8').slice(-500).toString())) {
      fail(`发布产物包含 sourceMappingURL：${name}`);
    }
  }

  assertObfuscated(resolve(distDir, 'background.js'), 'background.js');
  assertObfuscated(resolve(distDir, 'content-scripts/content.js'), 'content-scripts/content.js');

  const env = { ...readEnv(), ...process.env };
  const apiBase = (env.PUBFLOW_LICENSE_API_BASE_URL || '').trim();
  const protocolKey = (env.PUBFLOW_PROTOCOL_PUBLIC_KEY || '').trim().toLowerCase();
  const backgroundCode = existsSync(resolve(distDir, 'background.js'))
    ? readText(resolve(distDir, 'background.js'))
    : '';
  assertSerializablePageWorldFunctions(backgroundCode);
  if (backgroundCode.includes('__PUBFLOW_PROTOCOL_PUBLIC_KEY__')) {
    fail('协议公钥 define 占位符仍存在于产物中');
  }
  if (isRemoteUrl(apiBase) && !/^[0-9a-f]{64}$/.test(protocolKey)) {
    fail('远程授权服务发布构建必须配置 32 字节 hex PUBFLOW_PROTOCOL_PUBLIC_KEY');
  }
  if (protocolKey && backgroundCode.includes(protocolKey)) {
    warn('协议公钥以明文形式出现在 background.js；protected build 通常会被字符串数组编码。');
  }
  if (requireObfuscation && parseBooleanEnv(env.OBFUSCATE_LICENSE_UI)) {
    const nonRuntimeJsFiles = files.filter((filePath) => {
      const name = rel(filePath);
      return extname(filePath) === '.js'
        && name !== rel(resolve(distDir, 'background.js'))
        && name !== rel(resolve(distDir, 'content-scripts/content.js'));
    });
    const obfuscatedLicenseUiChunks = nonRuntimeJsFiles.filter((filePath) => {
      const code = readText(filePath);
      return (/function _0x[0-9a-fA-F]+/.test(code) && /_0x[0-9a-fA-F]+\(/.test(code))
        || (code.includes('.split(`.`)') && code.includes('decodeURIComponent'));
    });
    if (!obfuscatedLicenseUiChunks.length) {
      fail('OBFUSCATE_LICENSE_UI=1 但未发现轻量混淆的许可 UI chunk');
    }
    const leakedMarkers = ['licenseFeedbackText', 'activationCode', '授权有效'];
    for (const filePath of nonRuntimeJsFiles) {
      const code = readText(filePath);
      for (const marker of leakedMarkers) {
        if (code.includes(marker)) {
          warn(`许可 UI 轻量混淆后仍包含明文标记 ${marker}：${rel(filePath)}`);
        }
      }
    }
  }

  const sourceWasm = resolve(rootDir, 'src/licensing/wasm/pubflow_wasm_bg.wasm');
  const publicWasm = resolve(rootDir, 'public/wasm/pubflow_wasm_bg.wasm');
  const distWasm = resolve(distDir, 'wasm/pubflow_wasm_bg.wasm');
  if (assertExists(sourceWasm, 'src WASM') && assertExists(publicWasm, 'public WASM')) {
    const sourceHash = sha256(sourceWasm);
    const publicHash = sha256(publicWasm);
    if (sourceHash !== publicHash) {
      fail(`src/public WASM hash 不一致：${sourceHash} != ${publicHash}`);
    }
  }
  if (assertExists(distWasm, '发布 WASM') && statSync(distWasm).size < 100_000) {
    fail('发布 WASM 体积异常，可能未正确打包');
  }

  if (!relativeFiles.includes(rel(resolve(distDir, 'dashboard.html')))) {
    fail('缺少 dashboard.html');
  }
  if (!relativeFiles.includes(rel(resolve(distDir, 'sidepanel.html')))) {
    fail('缺少 sidepanel.html');
  }
}

if (warnings.length) {
  console.warn('Release verification warnings:');
  for (const message of warnings) console.warn(`- ${message}`);
}

if (failures.length) {
  console.error('Release verification failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Release verification passed: ${relative(rootDir, distDir)}`);
