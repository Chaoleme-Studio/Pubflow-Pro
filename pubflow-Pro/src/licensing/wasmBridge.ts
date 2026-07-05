import initWasm, * as wasmModule from './wasm/pubflow_wasm.js';

export interface PubFlowWasmBridge {
  pfap_build_activation_request(
    serverPublicKeyHex: string,
    activationCode: string,
    clientInstallId: string,
    platform: string,
    extensionVersion: string,
    serverTimeMs: bigint,
  ): string;
  pfap_decode_activation_response(responseBase64: string, responseKeyHex: string): string;
  pfsp_activation_code_hash(activationCode: string): string;
  pfsp_build_selector_request(
    serverPublicKeyHex: string,
    leaseToken: string,
    clientInstallId: string,
    activationCodeHash: string,
    selectorVersionKnown: number,
    extensionVersion: string,
    serverTimeMs: bigint,
  ): string;
  pfsp_decode_selector_response(responseBase64: string, responseKeyHex: string): string;
  pfsp_decrypt_selector_json(encryptedJson: string, activationCode: string): string;
}

declare global {
  interface Window {
    pubflowWasm?: PubFlowWasmBridge;
  }
}

let cachedBridge: PubFlowWasmBridge | null = null;
let loadingBridge: Promise<PubFlowWasmBridge> | null = null;

export async function loadPubFlowWasmBridge(): Promise<PubFlowWasmBridge> {
  if (cachedBridge) return cachedBridge;
  const globalBridge = typeof window !== 'undefined' ? window.pubflowWasm : undefined;
  if (globalBridge) {
    cachedBridge = globalBridge;
    return cachedBridge;
  }
  if (!loadingBridge) {
    loadingBridge = initStaticWasmBridge().finally(() => {
      loadingBridge = null;
    });
  }
  cachedBridge = await loadingBridge;
  if (typeof window !== 'undefined') {
    window.pubflowWasm = cachedBridge;
  }
  return cachedBridge;
}

async function initStaticWasmBridge(): Promise<PubFlowWasmBridge> {
  await initWasm();
  const bridge = wasmModule as Partial<PubFlowWasmBridge>;
  assertWasmBridge(bridge);
  return bridge;
}

function assertWasmBridge(value: Partial<PubFlowWasmBridge>): asserts value is PubFlowWasmBridge {
  const requiredFunctions: Array<keyof PubFlowWasmBridge> = [
    'pfap_build_activation_request',
    'pfap_decode_activation_response',
    'pfsp_activation_code_hash',
    'pfsp_build_selector_request',
    'pfsp_decode_selector_response',
    'pfsp_decrypt_selector_json',
  ];
  const missing = requiredFunctions.filter((name) => typeof value[name] !== 'function');
  if (missing.length) {
    throw new Error(`PubFlow WASM 协议模块缺少导出：${missing.join(', ')}，请重新构建 WASM。`);
  }
}
