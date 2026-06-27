/**
 * 通过 chrome.scripting.executeScript({ world: 'MAIN' }) 注入的抖音封面上传函数。
 * 必须完全自包含——不能引用此文件外部的任何变量或 import。
 * 在页面主世界运行，直接操作 React fiber 找到 Semi Design Upload 组件实例。
 *
 * 适用范围：抖音视频封面弹窗。
 * 文章封面编辑器没有 Semi Upload 组件，不能调用这个函数。
 */
/** 在抖音页面主世界注入封面文件到 Semi Upload 组件。 */
export async function injectDouyinCover(
  fileName: string,
  fileType: string,
  fileDataBase64: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 从 base64 重建 File 对象
    const byteChars = atob(fileDataBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteArray], fileName, { type: fileType });

    interface FiberNode {
      return: FiberNode | null;
      stateNode: Record<string, unknown> | null;
    }

    interface UploadInstance {
      foundation: Record<string, unknown>;
      props?: Record<string, unknown>;
      state?: Record<string, unknown>;
    }

    /** 沿 React fiber 向上查找 Semi Upload 组件实例。 */
    function findUploadInstance(el: Element): UploadInstance | null {
      // Semi Upload 的公开 DOM 只有壳，真正的 fileList 和 handleChange 在 React class instance 上。
      // content script 处于隔离世界拿不到这些对象，所以必须在 MAIN world 沿 React fiber 往上找 stateNode。
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) return null;

      let fib: FiberNode | null = (el as unknown as Record<string, unknown>)[fiberKey] as FiberNode | null;
      while (fib) {
        const sn = fib.stateNode;
        if (
          sn &&
          typeof sn === 'object' &&
          'foundation' in sn &&
          sn.foundation &&
          typeof sn.foundation === 'object'
        ) {
          const foundation = sn.foundation as Record<string, unknown>;
          const adapter = foundation._adapter as Record<string, unknown> | undefined;
          if (
            adapter &&
            typeof adapter.notifyFileSelect === 'function' &&
            typeof foundation.handleChange === 'function'
          ) {
            return sn as unknown as UploadInstance;
          }
        }
        fib = fib.return;
      }
      return null;
    }

    /** 判断元素是否在视觉可见。 */
    function isVisible(el: Element) {
      const rect = el.getBoundingClientRect();
      return Boolean(rect.width || rect.height || el.getClientRects().length);
    }

    /** 根据可见性、文案、样式和文件列表状态给 Upload 候选元素打分。 */
    function scoreUpload(el: Element, instance: UploadInstance) {
      const text = el.textContent?.trim() || '';
      const className = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
      const state = instance.state || {};
      const fileList = state.fileList;
      const fileListLength = Array.isArray(fileList) ? fileList.length : 0;
      const rect = el.getBoundingClientRect();
      let score = 0;

      if (isVisible(el)) score += 20;
      if (text.includes('点击上传文件') || text.includes('拖拽文件')) score += 80;
      if (text.includes('上传封面')) score += 40;
      if (className.includes('upload-')) score += 20;
      if (fileListLength === 0) score += 30;
      if (rect.width > 50 && rect.height > 40) score += 10;

      return score;
    }

    const dialog =
      document.querySelector('.dy-creator-content-modal-content') ||
      document.querySelector('.dy-creator-content-modal') ||
      document.querySelector('[role="dialog"]') ||
      document.querySelector('.semi-modal-content');

    const scope = dialog || document;
    const candidates = Array.from(scope.querySelectorAll('.semi-upload'))
      .map((el) => ({ el, instance: findUploadInstance(el) }))
      .filter((candidate): candidate is { el: Element; instance: UploadInstance } => Boolean(candidate.instance))
      .sort((a, b) => scoreUpload(b.el, b.instance) - scoreUpload(a.el, a.instance));

    if (candidates.length === 0) {
      return { ok: false, error: '弹窗中未找到可注入的 Semi Upload 组件' };
    }

    const target = candidates[0].instance;
    const foundation = target.foundation;
    const adapter = foundation._adapter as Record<string, unknown>;
    const origBeforeUpload = adapter.notifyBeforeUpload as ((...args: unknown[]) => unknown) | undefined;

    // 抖音视频封面上传组件默认会走自己的上传前校验和网络上传。
    // 这里让 beforeUpload 返回 success，避免真实网络上传阻塞自动化流程；
    // 随后调用 handleChange，让 React 组件把 File 放进内部 fileList 并渲染预览。
    adapter.notifyBeforeUpload = function () {
      return { shouldUpload: false, status: 'success' };
    };

    try {
      await (foundation.handleChange as (files: File[]) => Promise<void>)([file]);
      const fileList = target.state?.fileList;
      const fileListLength = Array.isArray(fileList) ? fileList.length : undefined;
      return fileListLength === 0
        ? { ok: false, error: '已调用上传组件，但组件 fileList 仍为空' }
        : { ok: true };
    } finally {
      if (origBeforeUpload) {
        adapter.notifyBeforeUpload = origBeforeUpload;
      } else {
        delete adapter.notifyBeforeUpload;
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 抖音文章封面编辑器点击“+替换封面”时会临时创建 file input，
 * 文件选择结束后 input 会被移除，不能像普通上传控件一样查 DOM。
 *
 * 实测路径：
 * 1. 点击文章页“选择封面”打开“编辑封面”弹窗。
 * 2. 点击弹窗底部“+替换封面”。
 * 3. 页面同步创建 `<input type="file" accept="image/...">` 并立即调用 input.click()。
 * 4. 文件选择结束后，input 从 DOM 移除，弹窗进入裁剪/预览状态。
 *
 * 扩展侧只有 File 对象，没有本机文件路径，无法使用 CDP setFileInputFiles。
 * 因此这里在 MAIN world 临时 patch HTMLInputElement.prototype.click，
 * 捕获第 3 步产生的临时 input，并直接派发 input/change。
 */
/** 在抖音文章封面编辑器捕获临时 file input 并注入封面文件。 */
export async function injectDouyinArticleCover(
  fileName: string,
  fileType: string,
  fileDataBase64: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const byteChars = atob(fileDataBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteArray], fileName, { type: fileType });

    /** 判断元素是否视觉可见。 */
    function isVisible(el: Element) {
      const rect = el.getBoundingClientRect();
      return Boolean(rect.width || rect.height || el.getClientRects().length);
    }

    /** 查找当前打开的文章封面编辑器弹窗。 */
    function findArticleCoverEditor(): HTMLElement | null {
      // 只认文章封面编辑器：必须同时包含“编辑封面 / 替换封面 / 完成”。
      // 视频封面弹窗文案是“设置横封面/设置竖封面”，不能混用。
      const candidates = document.querySelectorAll<HTMLElement>(
        '[class*="modalContainer"], [class*="modalOverlay"], [role="dialog"], [class*="Modal"], [class*="modal"]',
      );
      for (const candidate of candidates) {
        const text = candidate.textContent?.replace(/\s+/g, '') || '';
        if (isVisible(candidate) && text.includes('编辑封面') && text.includes('替换封面') && text.includes('完成')) {
          return candidate;
        }
      }
      return null;
    }

    /** 在编辑器弹窗内查找“替换封面”按钮。 */
    function findReplaceButton(scope: HTMLElement): HTMLElement | null {
      const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"], span, div');
      for (const button of buttons) {
        const text = button.textContent?.replace(/\s+/g, '') || '';
        if (!text.includes('替换封面')) continue;
        if (!isVisible(button)) continue;
        return button;
      }
      return null;
    }

    /** 将构造好的 File 对象写入 input 并派发 input/change 事件。 */
    function assignFile(input: HTMLInputElement) {
      // 与用户手动选择文件后的浏览器状态保持一致：
      // input.files 不可直接赋数组，需要通过 DataTransfer 构造 FileList。
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const editor = findArticleCoverEditor();
    if (!editor) return { ok: false, error: '没有打开抖音文章封面编辑器' };

    const replaceButton = findReplaceButton(editor);
    if (!replaceButton) return { ok: false, error: '没有找到抖音文章封面的替换按钮' };

    const originalClick = HTMLInputElement.prototype.click;
    let injected = false;
    HTMLInputElement.prototype.click = function patchedClick() {
      if (this.type === 'file') {
        const accept = this.accept || '';
        if (accept.includes('image') || accept.includes('.jpg') || accept.includes('.png') || accept.includes('.webp')) {
          injected = true;
          assignFile(this);
          return undefined;
        }
      }
      return originalClick.apply(this, arguments as unknown as []);
    };

    try {
      // patch 只包住这一次替换按钮点击，避免影响页面其他上传控件。
      replaceButton.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } finally {
      HTMLInputElement.prototype.click = originalClick;
    }

    if (!injected) return { ok: false, error: '抖音文章封面没有触发临时文件选择控件' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
