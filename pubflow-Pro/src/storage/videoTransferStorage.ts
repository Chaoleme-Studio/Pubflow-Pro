const CHUNK_SIZE = 2 * 1024 * 1024;
const BASE64_ENCODE_BATCH_SIZE = 0x8000;
const META_PREFIX = 'pubflow:video-transfer:meta:';
const CHUNK_PREFIX = 'pubflow:video-transfer:chunk:';

export interface VideoTransferMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  totalChunks: number;
  chunkSize: number;
  createdAt: number;
}

/** 构造视频/文件缓存的 meta 键名。 */
function metaKey(id: string) {
  return `${META_PREFIX}${id}`;
}

/** 构造视频/文件缓存的分片键名。 */
function chunkKey(id: string, index: number) {
  return `${CHUNK_PREFIX}${id}:${index}`;
}

/** 将 ArrayBuffer 编码为 base64，用于存入 chrome.storage.local。 */
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_ENCODE_BATCH_SIZE) {
    const batch = bytes.subarray(i, i + BASE64_ENCODE_BATCH_SIZE);
    binary += String.fromCharCode(...batch);
  }
  return btoa(binary);
}

/** 将 base64 解码为 Uint8Array。 */
function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 将文件分片存入 chrome.storage.local，用于跨页面传输大文件。 */
export async function storeFileForTransfer(file: File, existingId?: string) {
  if (existingId) {
    await cleanupFileTransfer(existingId);
  }

  const id = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const meta: VideoTransferMeta = {
    id,
    name: file.name,
    type: file.type || 'video/mp4',
    size: file.size,
    totalChunks,
    chunkSize: CHUNK_SIZE,
    createdAt: Date.now(),
  };

  await browser.storage.local.set({ [metaKey(id)]: meta });

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
    const buffer = await chunk.arrayBuffer();
    await browser.storage.local.set({ [chunkKey(id, index)]: arrayBufferToBase64(buffer) });
  }

  return meta;
}

/** 从 chrome.storage.local 读取并重组分片文件。 */
export async function loadFileForTransfer(id: string) {
  const stored = await browser.storage.local.get(metaKey(id));
  const meta = stored[metaKey(id)] as VideoTransferMeta | undefined;
  if (!meta) return null;

  const parts: Blob[] = [];
  for (let index = 0; index < meta.totalChunks; index += 1) {
    const key = chunkKey(id, index);
    const chunk = await browser.storage.local.get(key);
    const encoded = chunk[key] as string | undefined;
    if (!encoded) {
      throw new Error(`视频缓存不完整：缺少第 ${index + 1}/${meta.totalChunks} 片`);
    }
    parts.push(new Blob([base64ToUint8Array(encoded)], { type: meta.type }));
  }

  return new File(parts, meta.name, {
    type: meta.type,
    lastModified: meta.createdAt,
  });
}

/** 清理指定 ID 的文件缓存分片。 */
export async function cleanupFileTransfer(id?: string) {
  if (!id) return;
  const stored = await browser.storage.local.get(metaKey(id));
  const meta = stored[metaKey(id)] as VideoTransferMeta | undefined;
  const keys = [metaKey(id)];
  if (meta) {
    keys.push(...Array.from({ length: meta.totalChunks }, (_, index) => chunkKey(id, index)));
  }
  await browser.storage.local.remove(keys);
}

export const storeVideoForTransfer = storeFileForTransfer;
export const loadVideoForTransfer = loadFileForTransfer;
export const cleanupVideoTransfer = cleanupFileTransfer;
