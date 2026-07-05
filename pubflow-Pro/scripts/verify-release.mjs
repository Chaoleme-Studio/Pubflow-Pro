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
const failures = [];
const warnings = [];

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

if (!existsSync(distDir)) {
  fail(`发布目录不存在：${distDir}`);
} else {
  const packageJson = readJson('package.json');
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
