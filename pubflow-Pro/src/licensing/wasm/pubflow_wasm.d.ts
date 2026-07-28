/* tslint:disable */
/* eslint-disable */

/**
 * 检查 Lease 是否即将过期（3 天内）
 *
 * expires_at: Unix 时间戳（秒）
 * 返回 true 表示即将过期（需要续租）
 */
export function check_lease_expiring_soon(expires_at: bigint): boolean;

/**
 * 检查 License 是否过期
 *
 * expires_at: Unix 时间戳（秒）
 * 返回 true 表示已过期
 */
export function check_license_expired(expires_at: bigint): boolean;

/**
 * 解密 Selector 数据
 *
 * encrypted_json: 加密的 selector JSON
 * server_secret: 服务端密钥
 * license_code: 激活码（用于派生解密密钥）
 *
 * 返回解密后的 selector JSON 字符串
 */
export function decrypt_selectors(encrypted_json: string, server_secret: string, license_code: string): string;

/**
 * 生成设备哈希
 *
 * raw_id: 系统原始机器码
 * salt: 服务端盐值
 * 返回 hex 编码的 SHA-256 哈希
 */
export function generate_device_hash(raw_id: string, salt: string): string;

/**
 * WASM 初始化钩子（可选）
 */
export function init(): void;

/**
 * 构造 PFAP v1 激活请求。
 */
export function pfap_build_activation_request(server_public_key_hex: string, activation_code: string, client_install_id: string, platform: string, extension_version: string, server_time_ms: bigint): string;

/**
 * 解码 PFAP v1 激活响应。
 */
export function pfap_decode_activation_response(response_base64: string, response_key_hex: string): string;

/**
 * 构造 PFRP v1 认证帧，并返回本次连接的临时双向密钥。
 */
export function pfrp_build_auth(server_public_key_hex: string, auth_json: string, timestamp_ms: bigint): string;

/**
 * 解码并校验一条 PFRP 消息的认证标签和严格序号。
 */
export function pfrp_decode_message(frame_base64: string, key_hex: string, expected_sequence: bigint): string;

/**
 * 使用 PFRP 临时方向密钥编码一条严格有序的消息。
 */
export function pfrp_encode_message(payload_json: string, key_hex: string, sequence: bigint): string;

/**
 * 计算激活码哈希，用于 PFSP 请求，不直接传输激活码。
 */
export function pfsp_activation_code_hash(activation_code: string): string;

/**
 * 构造 PFSP v1 Selector 拉取请求。
 *
 * 返回 JSON：
 * {
 *   "ok": true,
 *   "request_base64": "...",
 *   "response_key_hex": "..."
 * }
 */
export function pfsp_build_selector_request(server_public_key_hex: string, lease_token: string, client_install_id: string, activation_code_hash_value: string, selector_version_known: number, extension_version: string, server_time_ms: bigint): string;

/**
 * 解码 PFSP v1 Selector 响应。
 */
export function pfsp_decode_selector_response(response_base64: string, response_key_hex: string): string;

/**
 * 解密 PFSP 下发的完整 Selector JSON。
 *
 * PFSP 响应体已经通过会话密钥保护；这里的二次加密只用于避免静态缓存中出现明文 selector。
 */
export function pfsp_decrypt_selector_json(encrypted_json: string, activation_code: string): string;

/**
 * 验证 License 签名
 *
 * license_json: License JSON 字符串
 * public_key_hex: Ed25519 公钥（32 字节，hex 编码）
 *
 * 返回 true 表示签名合法
 */
export function verify_license(license_json: string, public_key_hex: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly check_lease_expiring_soon: (a: bigint) => number;
    readonly check_license_expired: (a: bigint) => number;
    readonly decrypt_selectors: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly generate_device_hash: (a: number, b: number, c: number, d: number) => [number, number];
    readonly init: () => void;
    readonly pfap_build_activation_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint) => [number, number];
    readonly pfap_decode_activation_response: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pfrp_build_auth: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly pfrp_decode_message: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly pfrp_encode_message: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly pfsp_activation_code_hash: (a: number, b: number) => [number, number];
    readonly pfsp_build_selector_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint) => [number, number];
    readonly pfsp_decode_selector_response: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pfsp_decrypt_selector_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly verify_license: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
