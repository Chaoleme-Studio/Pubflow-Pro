/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const check_lease_expiring_soon: (a: bigint) => number;
export const check_license_expired: (a: bigint) => number;
export const decrypt_selectors: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
export const generate_device_hash: (a: number, b: number, c: number, d: number) => [number, number];
export const init: () => void;
export const pfap_build_activation_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint) => [number, number];
export const pfap_decode_activation_response: (a: number, b: number, c: number, d: number) => [number, number];
export const pfrp_build_auth: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
export const pfrp_decode_message: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
export const pfrp_encode_message: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
export const pfsp_activation_code_hash: (a: number, b: number) => [number, number];
export const pfsp_build_selector_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint) => [number, number];
export const pfsp_decode_selector_response: (a: number, b: number, c: number, d: number) => [number, number];
export const pfsp_decrypt_selector_json: (a: number, b: number, c: number, d: number) => [number, number];
export const verify_license: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
