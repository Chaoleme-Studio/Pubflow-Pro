import { querySelectorDeep } from './dom';

export const DEFAULT_UPLOAD_TIMEOUT_MS = 180000;
export const IMAGE_UPLOAD_SIGNAL_TIMEOUT_MS = 45000;
export const UPLOAD_BUTTON_SETTLE_MS = 600;
export const FILE_INPUT_WAIT_MS = 5000;
export const UPLOAD_BUTTON_RETRY_COUNT = 3;
export const UPLOAD_RETRY_SETTLE_MS = 1000;
export const FILE_ASSIGN_SETTLE_MS = 800;
export const QUICK_UPLOAD_SIGNAL_WAIT_MS = 2500;
export const DRAG_DROP_SETTLE_MS = 1000;
export const FALLBACK_UPLOAD_SETTLE_MS = 3000;

/** 判断 selector 当前是否存在，使用 deep DOM 查询兼容 shadowRoot/同源 iframe。 */
export function selectorExists(selector: string | undefined) {
  return Boolean(selector && querySelectorDeep(selector));
}

/** 将 File 数组注入到 input.files，并派发 input/change 触发平台上传逻辑。 */
export function assignFilesToInput(input: HTMLInputElement, files: File[]) {
  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(file);
  }
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 派发拖拽上传事件，作为直接 file input 注入不生效时的公共兜底。 */
export function dispatchDropUpload(container: HTMLElement, files: File[]) {
  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(file);
  }

  for (const type of ['dragenter', 'dragover', 'drop'] as const) {
    container.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
  }
}
