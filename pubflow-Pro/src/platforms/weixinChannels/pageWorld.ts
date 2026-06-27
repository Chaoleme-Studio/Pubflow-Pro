export type PageWorldAction =
  | 'fillEditor'
  | 'fillShortTitle'
  | 'fillArticleTitle'
  | 'uploadFile'
  | 'uploadImages'
  | 'uploadCover'
  | 'handleDeclarePopup'
  | 'checkReady'
  | 'waitReady'
  | 'handleSchedule';

export type PageWorldPayload = Record<string, unknown>;

/**
 * chrome.scripting.executeScript({ func }) serializes only the passed function.
 * Keep helpers inside this dispatcher so injected MAIN-world code stays self-contained.
 */
/** 视频号 page world 动作调度入口，按 action 分发到对应处理函数。 */
export async function runWeixinChannelsPageWorldAction(
  action: PageWorldAction,
  payload: PageWorldPayload,
): Promise<unknown> {
  /** 在 DOM 及 Shadow DOM / iframe 中递归查找单个元素 */
  function queryDeep(selector: string): Element | null {
    if (!selector) return null;
    const visitedRoots = new Set<Document | ShadowRoot | Element>();

    const find = (root: Document | ShadowRoot | Element): Element | null => {
      if (visitedRoots.has(root)) return null;
      visitedRoots.add(root);

      try {
        const direct = root.querySelector(selector);
        if (direct) return direct;
      } catch {
        return null;
      }

      for (const nestedRoot of listNestedRoots(root)) {
        const result = find(nestedRoot);
        if (result) return result;
      }

      return null;
    };

    return find(document);
  }

  /** 在 DOM 及 Shadow DOM / iframe 中递归查找所有匹配元素 */
  function queryDeepAll(selector: string): Element[] {
    const results: Element[] = [];
    const seen = new Set<Element>();
    const visitedRoots = new Set<Document | ShadowRoot | Element>();

    const collect = (root: Document | ShadowRoot | Element) => {
      if (visitedRoots.has(root)) return;
      visitedRoots.add(root);

      try {
        for (const el of root.querySelectorAll(selector)) {
          if (!seen.has(el)) {
            seen.add(el);
            results.push(el);
          }
        }
      } catch {
        // ignore invalid roots/selectors
      }

      for (const nestedRoot of listNestedRoots(root)) {
        collect(nestedRoot);
      }
    };

    collect(document);
    return results;
  }

  /** 遍历给定根节点，收集所有嵌套的 ShadowRoot 和 iframe contentDocument */
  function listNestedRoots(root: Document | ShadowRoot | Element): Array<Document | ShadowRoot> {
    const nestedRoots: Array<Document | ShadowRoot> = [];
    const walkerRoot = root instanceof Document ? root.documentElement : root;
    if (!walkerRoot) return nestedRoots;

    const ownerDoc = walkerRoot.ownerDocument;
    if (!ownerDoc) return nestedRoots;

    let walker: TreeWalker;
    try {
      walker = ownerDoc.createTreeWalker(walkerRoot, NodeFilter.SHOW_ELEMENT);
    } catch {
      return nestedRoots;
    }

    let current: Node | null = walker.currentNode;
    while (current) {
      const element = current as Element;
      if (element.shadowRoot) {
        nestedRoots.push(element.shadowRoot);
      }
      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            nestedRoots.push(element.contentDocument);
          }
        } catch {
          // ignore cross-origin frames
        }
      }
      current = walker.nextNode();
    }

    return nestedRoots;
  }

  /** 延迟指定毫秒数 */
  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 在编辑器中模拟按键输入 */
  function simulateKey(editor: HTMLElement, key: string) {
    const init: KeyboardEventInit = {
      key,
      code: key === 'Enter' ? 'Enter' : key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
      keyCode: key === 'Enter' ? 13 : key === ' ' ? 32 : key.charCodeAt(0),
      bubbles: true,
      cancelable: true,
    };
    editor.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key === 'Enter') {
      document.execCommand('insertParagraph', false);
    } else if (key === ' ') {
      document.execCommand('insertText', false, ' ');
    }
    editor.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  /** 查找页面主编辑器元素 */
  function findEditor(): HTMLElement | null {
    return queryDeep('div.input-editor') as HTMLElement | null;
  }

  /** 判断元素是否在视觉上可见 */
  function isVisible(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0
    );
  }

  /** 模拟真实鼠标点击事件序列触发元素点击 */
  function clickElement(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    };

    el.focus();
    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    el.click();
  }

  /** 查找页面中的视频文件上传 input 元素 */
  function findVideoInput(): HTMLInputElement | null {
    const inputs = queryDeepAll('input[type="file"]') as HTMLInputElement[];
    for (const input of inputs) {
      if (input.accept && input.accept.includes('video')) {
        return input;
      }
    }
    return inputs[0] || null;
  }

  /** 向编辑器填充标题、话题和描述内容 */
  async function fillEditor() {
    const title = String(payload.title || '');
    const topics = Array.isArray(payload.topics) ? payload.topics.map(String) : [];
    const description = String(payload.description || '');
    const skipTitle = Boolean(payload.skipTitle);

    const editor = findEditor();
    if (!editor) {
      return { ok: false, error: '页面主世界未找到 div.input-editor' };
    }

    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);

    if (!skipTitle && title) {
      document.execCommand('insertText', false, title);
    }

    if (!skipTitle && title && (topics.length > 0 || description)) {
      simulateKey(editor, 'Enter');
    }

    for (const rawTopic of topics) {
      const clean = rawTopic.trim().replace(/^#+/, '');
      if (!clean) continue;
      for (const char of `#${clean}`) {
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
        }));
        document.execCommand('insertText', false, char);
        editor.dispatchEvent(new KeyboardEvent('keyup', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
        }));
      }
      simulateKey(editor, ' ');
    }

    if (description) {
      if (topics.length > 0) {
        simulateKey(editor, 'Enter');
      }
      document.execCommand('insertText', false, description);
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    return { ok: true };
  }

  /** 填写视频短标题（6-16字概括） */
  async function fillShortTitle() {
    const title = String(payload.title || '')
      .replace(/[，,、。.!！；;\\/|()[\]{}（）【】]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return { ok: true };

    const inputs = queryDeepAll(
      [
        'input[placeholder*="概括视频主要内容"]',
        'input[placeholder*="短标题"]',
        'input[placeholder*="6-16"]',
        'input[maxlength="16"]',
      ].join(','),
    ) as HTMLInputElement[];
    const input = inputs.find((candidate) => {
      const scope = candidate.closest('label, .weui-desktop-form__control, .weui-desktop-form__item, .ant-form-item') || candidate.parentElement;
      const text = scope?.textContent?.trim() || '';
      return isVisible(candidate) && (
        text.includes('短标题') ||
        text.includes('概括视频主要内容') ||
        candidate.placeholder.includes('短标题') ||
        candidate.placeholder.includes('概括视频主要内容') ||
        candidate.maxLength === 16
      );
    }) || inputs.find((candidate) => isVisible(candidate)) || inputs[0];
    if (!input) {
      return { ok: false, error: '页面主世界未找到短标题输入框' };
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    nativeSetter?.call(input, title.slice(0, 16));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    return { ok: true };
  }

  /** 填写图文消息的标题 */
  async function fillArticleTitle() {
    const title = String(payload.title || '').trim();
    if (!title) return { ok: true };

    const inputs = queryDeepAll('input[placeholder*="标题"]') as HTMLInputElement[];
    const input = inputs.find((candidate) => isVisible(candidate)) || inputs[0];
    if (!input) {
      return { ok: false, error: '页面主世界未找到图文标题输入框' };
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    nativeSetter?.call(input, title.slice(0, 22));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    return { ok: true };
  }

  /** 上传视频文件到页面 */
  async function uploadFile() {
    const fileName = String(payload.fileName || '');
    const fileType = String(payload.fileType || '');
    const fileDataBase64 = String(payload.fileDataBase64 || '');
    const uploadDoneSelector = String(payload.uploadDoneSelector || '');
    const editorReadySelector = String(payload.editorReadySelector || '');
    const timeoutMs = Number(payload.timeoutMs || 180000);

    const byteChars = atob(fileDataBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteArray], fileName, { type: fileType });

    const input = findVideoInput();
    if (!input) {
      return { ok: false, error: '页面主世界未找到视频上传 input' };
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const deadline = Date.now() + timeoutMs;
    const checkSelectors = [uploadDoneSelector, editorReadySelector].filter(Boolean);
    while (checkSelectors.length > 0 && Date.now() <= deadline) {
      if (checkSelectors.some((selector) => queryDeep(selector))) {
        break;
      }
      await sleep(500);
    }

    return { ok: true };
  }

  /** 勾选原创声明和阅读协议复选框后点击声明原创 */
  async function handleDeclarePopup() {
    const allCheckboxes = queryDeepAll('input[type="checkbox"]') as HTMLInputElement[];
    for (const checkbox of allCheckboxes) {
      const parent = checkbox.closest('label') || checkbox.parentElement;
      const grandparent = parent?.parentElement;
      const text = ((parent?.textContent?.trim() || '') + ' ' + (grandparent?.textContent?.trim() || '')).trim();
      if ((text.includes('原创') || text.includes('声明')) && !text.includes('已阅读') && !checkbox.checked) {
        checkbox.click();
        break;
      }
    }

    await sleep(800);

    const agreementCheckboxes = queryDeepAll('input[type="checkbox"]') as HTMLInputElement[];
    for (const checkbox of agreementCheckboxes) {
      const parent = checkbox.closest('label') || checkbox.parentElement;
      const grandparent = parent?.parentElement;
      const text = ((parent?.textContent?.trim() || '') + ' ' + (grandparent?.textContent?.trim() || '')).trim();
      if ((text.includes('已阅读') || text.includes('已同意') || text.includes('同意《')) && !checkbox.checked) {
        checkbox.click();
        break;
      }
    }

    await sleep(500);

    const buttons = queryDeepAll('button') as HTMLElement[];
    for (const button of buttons) {
      const text = button.textContent?.trim() || '';
      if (text === '声明原创' && !button.hasAttribute('disabled') && button.offsetParent !== null) {
        button.click();
        return { ok: true };
      }
    }

    return { ok: true };
  }

  /** 检查页面是否已准备好进行内容填写 */
  function checkReady() {
    const readySelector = String(payload.readySelector || '');
    const editorSelector = String(payload.editorSelector || '');
    const fileInputSelectors = Array.isArray(payload.fileInputSelectors)
      ? payload.fileInputSelectors.map(String)
      : [];
    const uploadContainerSelector = String(payload.uploadContainerSelector || '');

    return (
      !!queryDeep(readySelector) ||
      !!queryDeep(editorSelector) ||
      fileInputSelectors.some((selector) => !!queryDeep(selector)) ||
      !!queryDeep(uploadContainerSelector)
    );
  }

  /** 等待指定选择器的元素出现并可见 */
  async function waitReady() {
    const selector = String(payload.selector || '');
    const timeoutMs = Number(payload.timeoutMs || 180000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const element = queryDeep(selector);
      if (element && isVisible(element)) {
        return { ok: true };
      }
      await sleep(500);
    }

    return { ok: false, error: `上传后没有等到可填写区域：${selector}` };
  }

  /** 将时间戳拆分为年月日时分等日期组成部分 */
  function getDateParts(timestamp: number) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return {
      date,
      year,
      month,
      day,
      dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      hours,
      minutes,
      timeStr: `${hours}:${minutes}`,
    };
  }

  /** 判断日期元素是否为禁用状态 */
  function isDisabledDateElement(element: HTMLElement) {
    const className = element.className?.toString() || '';
    const disabledAncestor = element.closest(
      '[aria-disabled="true"], [disabled], [class*="disabled"], [class*="Disabled"]',
    );
    return (
      element.getAttribute('aria-disabled') === 'true' ||
      element.hasAttribute('disabled') ||
      className.includes('disabled') ||
      className.includes('Disabled') ||
      Boolean(disabledAncestor && disabledAncestor !== element.closest('[class*="picker"], [class*="calendar"], [class*="date"]'))
    );
  }

  /** 判断元素是否已渲染（非 display:none / visibility:hidden） */
  function isRenderedElement(element: HTMLElement) {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** 判断元素是否位于日期选择器下拉面板内部 */
  function isInsideDatePicker(element: HTMLElement) {
    return Boolean(
      element.closest(
        [
          '.ant-picker-dropdown',
          '.weui-desktop-popover',
          '.weui-desktop-picker',
          '[class*="picker"]',
          '[class*="Picker"]',
          '[class*="calendar"]',
          '[class*="Calendar"]',
          '[class*="date"]',
          '[class*="Date"]',
        ].join(','),
      ),
    );
  }

  /** 提取日期候选元素的各种文本标识 */
  function getDateCandidateText(element: HTMLElement) {
    return [
      element.getAttribute('title') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('data-date') || '',
      element.getAttribute('data-value') || '',
      element.parentElement?.getAttribute('title') || '',
      element.textContent?.trim() || '',
    ].join(' ');
  }

  /** 根据日期匹配度对候选元素进行评分 */
  function scoreDateCandidate(element: HTMLElement, dateStr: string, targetDay: number) {
    if (!isRenderedElement(element) || isDisabledDateElement(element)) return 0;

    const className = element.className?.toString() || '';
    if (className.includes('ant-picker-cell') && !className.includes('ant-picker-cell-in-view')) return 0;

    const candidateText = getDateCandidateText(element);
    const compactText = candidateText.replace(/\s+/g, '');
    const dayText = element.textContent?.trim() || '';
    let score = 0;

    if (compactText.includes(dateStr)) score += 100;
    if (compactText.includes(dateStr.replace(/-/g, '/'))) score += 100;
    if (dayText === String(targetDay)) score += 20;
    if (className.includes('ant-picker-cell-selected') || className.includes('selected')) score += 5;
    if (isInsideDatePicker(element)) score += 15;

    return score;
  }

  /** 在微信原生日期时间选择器面板中查找目标日期元素 */
  function getPickerPanelDateElement(datetimeInput: HTMLInputElement, year: number, month: number, targetDay: number): HTMLElement | null {
    const picker = datetimeInput.closest('.weui-desktop-picker__date-time, .weui-desktop-picker__date');
    const panel = picker?.querySelector<HTMLElement>('.weui-desktop-picker__panel_day');
    if (!panel) return null;

    const labels = Array.from(panel.querySelectorAll<HTMLElement>('.weui-desktop-picker__panel__label'))
      .map((label) => label.textContent?.trim() || '')
      .join('');
    if (labels && (!labels.includes(`${year}年`) || !labels.includes(`${String(month).padStart(2, '0')}月`))) {
      return null;
    }

    const links = Array.from(panel.querySelectorAll<HTMLElement>('a'));
    return links.find((link) => {
      const text = link.textContent?.trim() || '';
      const className = link.className?.toString() || '';
      return text === String(targetDay) && !className.includes('disabled') && !className.includes('faded');
    }) || null;
  }

  /** 在页面中查找与目标日期最匹配的可点击日期元素 */
  function findTargetDateElement(dateStr: string, targetDay: number): HTMLElement | null {
    const selectors = [
      'td[title]',
      '[aria-label]',
      '[data-date]',
      '[data-value]',
      '.ant-picker-cell',
      '[class*="calendar"] a',
      '[class*="Calendar"] a',
      '[class*="date"] a',
      '[class*="Date"] a',
      'a',
    ].join(',');
    const candidates = queryDeepAll(selectors) as HTMLElement[];
    let best: HTMLElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = scoreDateCandidate(candidate, dateStr, targetDay);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best || bestScore < 20) return null;
    return best.querySelector<HTMLElement>('a, button, [role="button"], .ant-picker-cell-inner') || best;
  }

  /** 判断日期时间输入框是否已包含完整的日期和时间 */
  function isDatetimeInputAlreadySet(input: HTMLInputElement, dateStr: string, timeStr: string) {
    const value = input.value || '';
    return value.includes(dateStr) && value.includes(timeStr);
  }

  /** 判断日期时间输入框是否已包含目标日期 */
  function isDatetimeInputDateSet(input: HTMLInputElement, dateStr: string) {
    return (input.value || '').includes(dateStr);
  }

  /** 通过原生 setter 设置 input 的值并触发相应事件 */
  function setNativeInputValue(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /** 滚动元素到可视区域后模拟完整鼠标点击 */
  async function clickPickerElement(element: HTMLElement) {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await sleep(80);
    const rect = element.getBoundingClientRect();
    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    };
    element.dispatchEvent(new MouseEvent('mousedown', init));
    element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  }

  /** 在 Ant Design 时间选择面板中选中指定时分秒 */
  async function selectAntTimeCells(hours: string, minutes: string) {
    const timeColumns = queryDeepAll('.ant-picker-time-panel-column') as HTMLElement[];
    const values = [hours, minutes, '00'];
    for (let i = 0; i < Math.min(timeColumns.length, values.length); i++) {
      const cells = Array.from(timeColumns[i].querySelectorAll<HTMLElement>('.ant-picker-time-panel-cell'))
        .filter((cell) => isVisible(cell) && !isDisabledDateElement(cell));
      const target = cells.find((cell) => cell.textContent?.trim() === values[i]);
      if (target) {
        target.click();
        await sleep(200);
      }
    }
  }

  /** 在微信原生日期时间选择器中设置时间 */
  async function selectWeixinTime(datetimeInput: HTMLInputElement, hours: string, minutes: string) {
    const picker = datetimeInput.closest('.weui-desktop-picker__date-time, .weui-desktop-picker__date');
    const timePicker = picker?.querySelector<HTMLElement>('.weui-desktop-picker__time');
    if (!timePicker) return false;

    const timeStr = `${hours}:${minutes}`;
    const timeInput = timePicker.querySelector<HTMLInputElement>('input[placeholder="请选择时间"], input:not([readonly])');
    if (timeInput) {
      await clickPickerElement(timeInput);
      await sleep(300);
    }

    const panel = timePicker.querySelector<HTMLElement>('.weui-desktop-picker__dd__time, .weui-desktop-picker__panel_time');
    if (!panel) {
      if (timeInput) setNativeInputValue(timeInput, timeStr);
      return Boolean(timeInput);
    }

    const columns = [
      panel.querySelector<HTMLElement>('.weui-desktop-picker__time__hour'),
      panel.querySelector<HTMLElement>('.weui-desktop-picker__time__minute'),
    ].filter((column): column is HTMLElement => Boolean(column));
    const values = [hours, minutes];
    for (let index = 0; index < Math.min(columns.length, values.length); index++) {
      const options = Array.from(columns[index].querySelectorAll<HTMLElement>('li, a, [class*="item"]'));
      const target = options.find((option) => {
        const text = option.textContent?.trim() || '';
        const className = option.className?.toString() || '';
        return text === values[index] && !className.includes('disabled');
      });
      if (target) {
        const clickTarget = target.querySelector<HTMLElement>('a, button, [role="button"]') || target;
        await clickPickerElement(clickTarget);
        await sleep(200);
      }
    }

    if (timeInput && !timeInput.value.includes(timeStr)) {
      setNativeInputValue(timeInput, timeStr);
      await sleep(100);
    }

    return Boolean(timeInput ? timeInput.value.includes(timeStr) : true);
  }

  /** 点击日期时间选择器的确定按钮 */
  async function confirmDateTimePicker() {
    const buttons = queryDeepAll('button, [role="button"], a') as HTMLElement[];
    const confirmButton = buttons.find((button) => {
      const text = button.textContent?.trim() || '';
      return isVisible(button) && text === '确定' && isInsideDatePicker(button);
    });
    if (confirmButton) {
      confirmButton.click();
      await sleep(300);
      return true;
    }
    return false;
  }

  /** 设置定时发布的时间 */
  async function handleSchedule() {
    const scheduledAt = Number(payload.scheduledAt || 0);
    const radios = queryDeepAll('input[type="radio"]') as HTMLInputElement[];
    let scheduleRadio: HTMLInputElement | null = null;
    for (const radio of radios) {
      const parent = radio.closest('label') || radio.parentElement;
      const text = parent?.textContent?.trim() || '';
      if (text.includes('定时') && !text.includes('不定')) {
        scheduleRadio = radio;
        break;
      }
    }

    if (!scheduleRadio) {
      const allElements = queryDeepAll('*') as HTMLElement[];
      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        if (text === '定时' && el.offsetParent !== null && el.children.length === 0) {
          el.click();
          break;
        }
      }
      return { ok: false, error: '未找到定时发布 radio 按钮' };
    }

    if (!scheduleRadio.checked) {
      scheduleRadio.click();
      await sleep(500);
    }

    const { year, month, day: targetDay, dateStr, hours, minutes, timeStr } = getDateParts(scheduledAt);

    const datetimeInputs = queryDeepAll('input[readonly]') as HTMLInputElement[];
    let datetimeInput: HTMLInputElement | null = null;
    for (const input of datetimeInputs) {
      const placeholder = input.placeholder || '';
      if (placeholder.includes('发表时间') || placeholder.includes('日期') || placeholder.includes('时间')) {
        datetimeInput = input;
        break;
      }
    }
    if (!datetimeInput) {
      for (const input of datetimeInputs) {
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(input.value || '')) {
          datetimeInput = input;
          break;
        }
      }
    }
    if (!datetimeInput) {
      return { ok: false, error: '未找到日期时间输入框' };
    }

    if (isDatetimeInputAlreadySet(datetimeInput, dateStr, timeStr)) return { ok: true };

    datetimeInput.click();
    await sleep(800);

    if (!isDatetimeInputDateSet(datetimeInput, dateStr)) {
      const targetDateElement = getPickerPanelDateElement(datetimeInput, year, month, targetDay) || findTargetDateElement(dateStr, targetDay);
      if (targetDateElement) {
        targetDateElement.click();
        await sleep(500);
      } else {
        return { ok: false, error: `未找到目标定时日期：${dateStr}` };
      }
    }

    await selectAntTimeCells(hours, minutes);
    const weixinTimeSelected = await selectWeixinTime(datetimeInput, hours, minutes);

    const timeInputs = queryDeepAll('input') as HTMLInputElement[];
    for (const input of timeInputs) {
      const placeholder = input.placeholder || '';
      if (input !== datetimeInput && !input.readOnly && placeholder.includes('请选择时间')) {
        setNativeInputValue(input, timeStr);
        break;
      }
    }

    await confirmDateTimePicker();

    await sleep(300);
    if (!isDatetimeInputAlreadySet(datetimeInput, dateStr, timeStr)) {
      if (!weixinTimeSelected) {
        return { ok: false, error: `未找到目标定时时间：${timeStr}` };
      }
      setNativeInputValue(datetimeInput, `${dateStr} ${timeStr}`);
      await sleep(100);
    }

    const body = document.querySelector('body');
    if (body) {
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    }

    return { ok: true };
  }

  /** 上传图片文件到编辑器 */
  async function uploadImages() {
    const filesData = Array.isArray(payload.files) ? payload.files as Array<{ fileName: string; fileType: string; fileDataBase64: string }> : [];
    const uploadDoneSelector = String(payload.uploadDoneSelector || '');
    const editorReadySelector = String(payload.editorReadySelector || '');
    const timeoutMs = Number(payload.timeoutMs || 180000);

    if (filesData.length === 0) {
      return { ok: false, error: '没有图片数据' };
    }

    const uploadSignature = filesData
      .map((file) => `${file.fileName}:${file.fileType}:${file.fileDataBase64.length}`)
      .join('|');
    const uploadStateKey = '__pubflowWeixinImageUploadState';
    const uploadState = (window as unknown as Record<string, { signature?: string; uploadedAt?: number; uploading?: boolean }>)[uploadStateKey] || {};
    (window as unknown as Record<string, typeof uploadState>)[uploadStateKey] = uploadState;

    if (uploadState.signature === uploadSignature && (uploadState.uploading || Date.now() - (uploadState.uploadedAt || 0) < 30 * 60 * 1000)) {
      return { ok: true, uploadedCount: filesData.length, skipped: true };
    }

    uploadState.signature = uploadSignature;
    uploadState.uploading = true;

    const files: File[] = [];
    for (const fileData of filesData) {
      const byteChars = atob(fileData.fileDataBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      files.push(new File([byteArray], fileData.fileName, { type: fileData.fileType }));
    }

    const imageInputSelector = [
      'input[type="file"][accept*="image"]',
      'input[type="file"][accept*=".jpg"]',
      'input[type="file"][accept*=".jpeg"]',
      'input[type="file"][accept*=".png"]',
      'input[type="file"][accept*=".webp"]',
    ].join(',');

    let input: HTMLInputElement | null = null;
    const inputs = queryDeepAll('input[type="file"]') as HTMLInputElement[];
    for (const candidate of inputs) {
      const accept = candidate.accept || '';
      if (accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png')) {
        input = candidate;
        break;
      }
    }
    if (!input) {
      input = queryDeep(imageInputSelector) as HTMLInputElement | null;
    }
    if (!input) {
      input = inputs[0] || null;
    }
    if (!input) {
      return { ok: false, error: '页面主世界未找到图片上传 input' };
    }

    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }

    try {
      input.files = dt.files;
    } catch {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: dt.files,
      });
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    const deadline = Date.now() + timeoutMs;
    const checkSelectors = [uploadDoneSelector, editorReadySelector].filter(Boolean);
    while (checkSelectors.length > 0 && Date.now() <= deadline) {
      if (checkSelectors.some((selector) => queryDeep(selector))) {
        break;
      }
      await sleep(500);
    }

    uploadState.uploadedAt = Date.now();
    uploadState.uploading = false;
    return { ok: true, uploadedCount: files.length };
  }

  /** 上传并设置视频或图文封面 */
  async function uploadCover() {
    const fileName = String(payload.fileName || '');
    const fileType = String(payload.fileType || '');
    const fileDataBase64 = String(payload.fileDataBase64 || '');
    const coverSelector = String(payload.coverSelector || '');

    const byteChars = atob(fileDataBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteArray], fileName, { type: fileType });

    /** 判断按钮是否为禁用状态 */
    function isDisabledButton(el: HTMLElement): boolean {
      return (
        el.hasAttribute('disabled') ||
        el.classList.contains('weui-desktop-btn_disabled') ||
        el.getAttribute('aria-disabled') === 'true'
      );
    }

    /** 将文件设置到 input 元素上 */
    function setInputFile(input: HTMLInputElement, targetFile: File) {
      const dt = new DataTransfer();
      dt.items.add(targetFile);
      try {
        input.files = dt.files;
      } catch {
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: dt.files,
        });
      }
    }

    /** 触发 input 的 change 事件 */
    function dispatchInputFileChange(input: HTMLInputElement) {
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    /** 设置文件并触发 change 事件 */
    function assignInputFile(input: HTMLInputElement, targetFile: File) {
      setInputFile(input, targetFile);
      dispatchInputFileChange(input);
    }

    /** 获取对话框标题文本 */
    function getDialogTitle(dialog: HTMLElement): string {
      const directDialog = Array.from(dialog.children)
        .find((child) => child.classList.contains('weui-desktop-dialog')) as HTMLElement | undefined;
      const title = directDialog?.querySelector('.weui-desktop-dialog__hd .weui-desktop-dialog__title');
      return title?.textContent?.trim() || '';
    }

    /** 查找当前活动的封面编辑对话框 */
    function findActiveCoverDialog(expectedTitle?: string): HTMLElement | null {
      const dialogs = queryDeepAll('.edit-cover-dialog .weui-desktop-dialog__wrp, .finder-common-dialog.edit-cover-dialog .weui-desktop-dialog__wrp') as HTMLElement[];
      for (const dialog of dialogs) {
        const title = getDialogTitle(dialog);
        const text = dialog.textContent?.replace(/\s+/g, '') || '';
        if (!isVisible(dialog)) continue;
        if (!text.includes('上传封面') || !text.includes('确认')) continue;
        if (expectedTitle && title !== expectedTitle) continue;
        return dialog;
      }
      return null;
    }

    /** 查找裁剪封面图的对话框 */
    function findCropDialog(): HTMLElement | null {
      const dialogs = queryDeepAll('.finder-common-dialog .weui-desktop-dialog__wrp') as HTMLElement[];
      for (const dialog of dialogs) {
        const title = getDialogTitle(dialog);
        if (isVisible(dialog) && title === '裁剪封面图') {
          return dialog;
        }
      }
      return null;
    }

    /** 在指定范围内查找包含指定文本的可用按钮 */
    function findScopedButton(scope: HTMLElement, texts: string[]): HTMLElement | null {
      const buttons = Array.from(scope.querySelectorAll('button')) as HTMLElement[];
      for (const button of buttons) {
        const text = button.textContent?.trim() || '';
        if (texts.includes(text) && isVisible(button) && !isDisabledButton(button)) {
          return button;
        }
      }
      return null;
    }

    /** 在全局查找包含指定文本的可用按钮 */
    function findVisibleButtonByText(texts: string[]): HTMLElement | null {
      const candidates = queryDeepAll('button, [role="button"], .weui-desktop-btn') as HTMLElement[];
      for (const candidate of candidates) {
        const text = candidate.textContent?.trim() || '';
        if (texts.includes(text) && isVisible(candidate) && !isDisabledButton(candidate)) {
          return candidate;
        }
      }
      return null;
    }

    /** 查找封面编辑入口元素 */
    function findCoverEntry(entrySelector: string): HTMLElement | null {
      const editButton = queryDeep(`${entrySelector} .edit-btn`) as HTMLElement | null;
      if (editButton && isVisible(editButton)) return editButton;
      const entry = queryDeep(entrySelector) as HTMLElement | null;
      return entry && isVisible(entry) ? entry : null;
    }

    /** 在对话框中查找封面图片上传 input */
    function findCoverInput(dialog: HTMLElement): HTMLInputElement | null {
      const inputs = Array.from(dialog.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
      for (const input of inputs) {
        const accept = input.accept || '';
        if (accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png')) {
          return input;
        }
      }
      return null;
    }

    /** 判断字符串是否为有效的 Data URL 图片 */
    function isValidDataImage(src: string): boolean {
      return /^data:image\/(?:png|jpe?g);base64,/i.test(src) && src.length > 1000;
    }

    /** 在对话框中查找 Vue 封面上传组件 */
    function findCoverUploader(dialog: HTMLElement): (HTMLElement & {
      __vue__?: {
        handleCropping?: (file: File) => unknown;
        handleUpload?: (file: File) => unknown;
        onInputChange?: (event: Event) => unknown;
        imgSrc?: string;
        customCoverPreviewUrl?: string;
        $refs?: {
          croppieRef?: {
            result?: (options?: unknown) => string | Blob | Promise<string | Blob>;
            $el?: HTMLElement;
          };
        };
        $parent?: unknown;
      };
    }) | null {
      return dialog.querySelector('.single-cover-uploader-wrap') as (HTMLElement & {
        __vue__?: {
          handleCropping?: (file: File) => unknown;
          handleUpload?: (file: File) => unknown;
          onInputChange?: (event: Event) => unknown;
          imgSrc?: string;
          customCoverPreviewUrl?: string;
          $refs?: {
            croppieRef?: {
              result?: (options?: unknown) => string | Blob | Promise<string | Blob>;
              $el?: HTMLElement;
            };
          };
          $parent?: unknown;
        };
      }) | null;
    }

    /** 触发封面上传组件的文件变更 */
    async function triggerCoverUploader(input: HTMLInputElement, targetFile: File) {
      const uploader = input.closest('.single-cover-uploader-wrap') as ReturnType<typeof findCoverUploader>;
      const vueUploader = uploader?.__vue__;

      setInputFile(input, targetFile);

      if (vueUploader?.onInputChange) {
        const event = new Event('change', { bubbles: true, composed: true });
        Object.defineProperty(event, 'target', { configurable: true, value: input });
        Object.defineProperty(event, 'currentTarget', { configurable: true, value: input });
        await Promise.resolve(vueUploader.onInputChange(event));
        return;
      }

      dispatchInputFileChange(input);
    }

    /** 触发封面裁剪流程 */
    function triggerCoverCropping(input: HTMLInputElement, targetFile: File): boolean {
      const uploader = input.closest('.single-cover-uploader-wrap') as ReturnType<typeof findCoverUploader>;
      const vueUploader = uploader?.__vue__;
      if (!vueUploader?.handleCropping) return false;
      vueUploader.handleCropping(targetFile);
      return true;
    }

    /** 等待 Croppie 裁剪结果并返回 base64 图片数据 */
    async function waitForCroppieResult(dialog: HTMLElement, timeoutMs: number): Promise<string | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const cropDialog = findCropDialog();
        const canvas = cropDialog?.querySelector('canvas.cr-image') as HTMLCanvasElement | null;
        if (cropDialog && canvas && isVisible(cropDialog) && canvas.width > 0 && canvas.height > 0) {
          // handleCropping 可能触发了 Vue 组件重渲染，每次循环重新获取上传组件和 croppieRef
          const uploader = findCoverUploader(dialog);
          const croppieRef = uploader?.__vue__?.$refs?.croppieRef;
          try {
            const result = await croppieRef?.result?.({ type: 'base64', format: 'png', size: 'viewport' });
            if (typeof result === 'string' && isValidDataImage(result)) {
              return result;
            }
          } catch {
            // Croppie may not be fully bound yet.
          }
        }
        await sleep(300);
      }
      return null;
    }

    /** 将 Data URL 图片绘制到 Canvas 上 */
    async function dataImageToCanvas(src: string): Promise<HTMLCanvasElement> {
      const image = new Image();
      image.src = src;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('视频号封面裁剪结果图片加载失败'));
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建视频号封面 Canvas');
      context.drawImage(image, 0, 0);
      return canvas;
    }

    /** 将文件读取为图片并绘制到 Canvas */
    async function fileToCanvas(targetFile: File): Promise<HTMLCanvasElement> {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('视频号封面文件读取失败'));
        reader.readAsDataURL(targetFile);
      });
      return dataImageToCanvas(src);
    }

    type WeixinCoverVueComponent = {
      handleCustomCoverChange?: (canvas: HTMLCanvasElement) => unknown;
      customCoverPreviewUrl?: string;
      previewImageUrl?: string;
      currentCoverImageUrl?: string;
      $el?: HTMLElement;
      $parent?: unknown;
    };

    /** 沿 Vue 组件祖先链查找处理自定义封面变更的组件 */
    function findAncestorWithCustomCoverHandler(vueUploader: unknown): WeixinCoverVueComponent | null {
      let current = (vueUploader as { $parent?: unknown } | null)?.$parent;
      let fallback: WeixinCoverVueComponent | null = null;
      for (let depth = 0; current && depth < 8; depth++) {
        const candidate = current as WeixinCoverVueComponent;
        if (typeof candidate.handleCustomCoverChange === 'function') {
          fallback ||= candidate;

          const className = String(candidate.$el?.className || '');
          const hasDialogPreviewState =
            'previewImageUrl' in candidate ||
            'currentCoverImageUrl' in candidate ||
            candidate.$el?.classList?.contains('edit-cover-dialog-container');

          if (className.includes('edit-cover-dialog-container') || hasDialogPreviewState) {
            return candidate;
          }
        }
        current = candidate.$parent;
      }
      return fallback;
    }

    /** 将 Croppie 裁剪结果应用到封面 */
    async function applyCroppieResultToCover(dialog: HTMLElement, result: string): Promise<boolean> {
      const uploader = findCoverUploader(dialog);
      const vueUploader = uploader?.__vue__;
      if (!vueUploader) return false;

      const canvas = await dataImageToCanvas(result);
      const coverHandler = findAncestorWithCustomCoverHandler(vueUploader);
      if (!coverHandler?.handleCustomCoverChange) return false;

      coverHandler.handleCustomCoverChange(canvas);

      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        const handleSuccess = (vueUploader as { handleSuccess?: (file: Blob) => unknown }).handleSuccess;
        if (blob && typeof handleSuccess === 'function') {
          handleSuccess.call(vueUploader, blob);
        }
      } catch {
        // The parent preview is the source of truth; uploader thumbnail is best effort.
      }

      try {
        (vueUploader as { handleCropVisibleChange?: (visible: boolean) => unknown })
          .handleCropVisibleChange?.(false);
      } catch {
        // ignore
      }
      try {
        (vueUploader as { isCropping?: boolean }).isCropping = false;
      } catch {
        // ignore
      }

      return true;
    }

    /** 将文件直接应用到封面对话框 */
    async function applyCoverFileToDialog(dialog: HTMLElement, targetFile: File): Promise<boolean> {
      const uploader = findCoverUploader(dialog);
      const vueUploader = uploader?.__vue__;
      if (!vueUploader) return false;

      const coverHandler = findAncestorWithCustomCoverHandler(vueUploader);
      if (!coverHandler?.handleCustomCoverChange) return false;

      const canvas = await fileToCanvas(targetFile);
      coverHandler.handleCustomCoverChange(canvas);

      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        const handleSuccess = (vueUploader as { handleSuccess?: (file: Blob) => unknown }).handleSuccess;
        if (blob && typeof handleSuccess === 'function') {
          handleSuccess.call(vueUploader, blob);
        }
      } catch {
        // The edit-cover dialog state is the source of truth.
      }

      return true;
    }

    /** 等待上传组件预览图片就绪 */
    async function waitForUploaderPreview(dialog: HTMLElement, timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        // 裁剪确定后 Vue 组件可能替换了 .single-cover-uploader-wrap，每次循环重新查找
        const uploader = findCoverUploader(dialog);
        const vueUploader = uploader?.__vue__;
        const coverHandler = vueUploader ? findAncestorWithCustomCoverHandler(vueUploader) : null;
        const imgSrc = String(vueUploader?.imgSrc || '');
        const customCoverPreviewUrl = String(vueUploader?.customCoverPreviewUrl || '');
        const image = uploader?.querySelector('.finish-wrap img, img.img-wrap') as HTMLImageElement | null;
        const domSrc = image?.src || '';
        const previewImage = dialog.querySelector(
          '.preview-image img, .horizontal-preview-image img, .preview-image-center img, img[src^="data:image/"]',
        ) as HTMLImageElement | null;
        const previewImageUrl = String(coverHandler?.previewImageUrl || '');
        const currentCoverImageUrl = String(coverHandler?.currentCoverImageUrl || '');
        const dialogCustomCoverPreviewUrl = String(coverHandler?.customCoverPreviewUrl || '');
        const previewDomSrc = previewImage?.src || '';

        if ([
          imgSrc,
          customCoverPreviewUrl,
          domSrc,
          previewImageUrl,
          currentCoverImageUrl,
          dialogCustomCoverPreviewUrl,
          previewDomSrc,
        ].some(isValidDataImage)) {
          return true;
        }
        await sleep(300);
      }
      return false;
    }

    /** 检查封面区域是否显示生成中状态 */
    function hasGeneratingCoverText(): boolean {
      const coverArea = queryDeep('.cover-preview-wrap');
      const scopes = coverArea ? [coverArea] : queryDeepAll('.vertical-cover-wrap, .horizon-cover-wrap');
      return scopes.some((scope) => isVisible(scope) && (scope.textContent || '').includes('生成中'));
    }

    /** 等待封面生成完成 */
    async function waitForCoverGenerationReady(timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const vertical = queryDeep('.vertical-cover-wrap') as HTMLElement | null;
        const horizon = queryDeep('.horizon-cover-wrap') as HTMLElement | null;
        if (vertical && horizon && isVisible(vertical) && isVisible(horizon) && !hasGeneratingCoverText()) {
          return true;
        }
        await sleep(500);
      }
      return !hasGeneratingCoverText();
    }

    /** 等待封面编辑对话框出现 */
    async function waitForDialog(expectedTitle: string, timeoutMs: number): Promise<HTMLElement | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const dialog = findActiveCoverDialog(expectedTitle);
        if (dialog) return dialog;
        await sleep(250);
      }
      return null;
    }

    /** 等待封面编辑对话框关闭 */
    async function waitForDialogClosed(expectedTitle: string, timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (!findActiveCoverDialog(expectedTitle)) return true;
        await sleep(250);
      }
      return false;
    }

    /** 等待裁剪对话框出现 */
    async function waitForCropDialog(timeoutMs: number): Promise<HTMLElement | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const dialog = findCropDialog();
        if (dialog) return dialog;
        await sleep(250);
      }
      return null;
    }

    /** 等待素材选择浮层出现 */
    async function waitForMaterialPopover(timeoutMs: number): Promise<HTMLElement | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const button = findVisibleButtonByText(['直接编辑']);
        const text = button?.closest('.ant-popover, .weui-desktop-popover, .weui-desktop-popover__inner')
          ?.textContent?.replace(/\s+/g, '') || '';
        if (button && text.includes('使用此素材作为封面')) {
          return button;
        }
        await sleep(250);
      }
      return null;
    }

    /** 打开封面编辑对话框 */
    async function openCoverDialog(entrySelector: string, expectedTitle: string): Promise<HTMLElement | null> {
      const entry = findCoverEntry(entrySelector);
      if (!entry) return null;

      entry.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(250);
      clickElement(entry);

      let dialog = await waitForDialog(expectedTitle, 1800);
      if (dialog) return dialog;

      const directEdit = await waitForMaterialPopover(2500);
      if (directEdit) {
        clickElement(directEdit);
        dialog = await waitForDialog(expectedTitle, 8000);
        if (dialog) return dialog;
      }

      const fallbackEntry = queryDeep(entrySelector) as HTMLElement | null;
      if (fallbackEntry && fallbackEntry !== entry) {
        fallbackEntry.scrollIntoView({ block: 'center', inline: 'nearest' });
        await sleep(250);
        clickElement(fallbackEntry);
        dialog = await waitForDialog(expectedTitle, 1800);
        if (dialog) return dialog;

        const fallbackDirectEdit = await waitForMaterialPopover(2500);
        if (fallbackDirectEdit) {
          clickElement(fallbackDirectEdit);
          dialog = await waitForDialog(expectedTitle, 8000);
        }
      }

      return dialog;
    }

    /** 上传单个封面 */
    async function uploadOneCover(entrySelector: string, expectedTitle: string): Promise<boolean> {
      const dialog = await openCoverDialog(entrySelector, expectedTitle);
      if (!dialog) return false;

      const input = findCoverInput(dialog);
      if (!input) return false;

      const directApplied = await applyCoverFileToDialog(dialog, file);
      const directPreviewReady = directApplied && await waitForUploaderPreview(dialog, 5000);

      let cropDialog: HTMLElement | null = null;
      if (!directPreviewReady) {
        await triggerCoverUploader(input, file);
        cropDialog = await waitForCropDialog(3000);
      }
      if (!cropDialog && !directPreviewReady) {
        if (!triggerCoverCropping(input, file)) return false;
        cropDialog = await waitForCropDialog(10000);
      }

      const cropConfirm = cropDialog ? findScopedButton(cropDialog, ['确定']) : null;
      if (cropConfirm) {
        const cropResult = await waitForCroppieResult(dialog, 10000);
        if (!cropResult) return false;
        const applied = await applyCroppieResultToCover(dialog, cropResult);
        if (!applied) return false;
        const previewReady = await waitForUploaderPreview(dialog, 15000);
        if (!previewReady) return false;
      } else if (!directPreviewReady) {
        await sleep(2000);
      }

      const currentDialog = findActiveCoverDialog(expectedTitle) || dialog;
      const confirmButton = findScopedButton(currentDialog, ['确认']);
      if (!confirmButton) return false;

      clickElement(confirmButton);
      return waitForDialogClosed(expectedTitle, 10000);
    }

    const coverTargets = coverSelector
      ? [{ selector: coverSelector, title: '' }]
      : [
        { selector: '.vertical-cover-wrap', title: '编辑个人主页卡片' },
        { selector: '.horizon-cover-wrap', title: '编辑分享卡片' },
      ];

    await waitForCoverGenerationReady(60000);

    const results: string[] = [];
    for (const target of coverTargets) {
      const title = target.title || '编辑';
      const ok = await uploadOneCover(target.selector, title);
      results.push(`${title}:${ok ? 'ok' : 'failed'}`);
    }

    const failed = results.filter((result) => result.includes('failed'));
    if (failed.length > 0) {
      return { ok: false, error: `视频号封面上传未全部完成：${results.join(', ')}` };
    }

    return { ok: true };
  }

  if (action === 'fillEditor') return fillEditor();
  if (action === 'fillShortTitle') return fillShortTitle();
  if (action === 'fillArticleTitle') return fillArticleTitle();
  if (action === 'uploadFile') return uploadFile();
  if (action === 'uploadImages') return uploadImages();
  if (action === 'uploadCover') return uploadCover();
  if (action === 'handleDeclarePopup') return handleDeclarePopup();
  if (action === 'checkReady') return checkReady();
  if (action === 'waitReady') return waitReady();
  if (action === 'handleSchedule') return handleSchedule();

  return { ok: false, error: `未知视频号页面动作：${action}` };
}
