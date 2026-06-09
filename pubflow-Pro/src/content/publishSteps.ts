/* 
630 行，包含 6 个共享函数。5 个平台（抖音、小红书、B站、快手、微博）共用这些逻辑。
长度主要来自 fillScheduled（260 行）和 fillDeclarationDropdown（136行），
因为要处理多种控件类型（radio/switch/checkbox/dropdown）和跨平台的 DOM 差异。
它必须这么长 — 这些是共享的基础发布步骤，拆开会导致重复代码。            

*/


import { querySelectorDeep, waitForSelector } from './dom';
import { humanDelay } from './fieldFiller';
import type { PlatformConfig } from '../platforms';

const DEFAULT_EDITOR_READY_TIMEOUT_MS = 180000;
const ANT_PICKER_OPEN_DELAY_MS = 800;
const ANT_PICKER_SELECTION_SETTLE_MS = 300;
const ANT_PICKER_TIME_SELECTION_SETTLE_MS = 200;
const TIMER_PICKER_OPEN_DELAY_MS = 600;
const TIMER_PICKER_NAVIGATION_SETTLE_MS = 400;
const TIMER_PICKER_SELECTION_SETTLE_MS = 300;
const TIME_PICKER_MINUTE_STEP = 5;

/** 等待视频发布页进入可填写状态，主要用于上传视频后的通用流程。 */
export async function waitForEditorReady(config: PlatformConfig) {
  return waitForEditorReadyWithUpload(config, config.upload);
}

/** 等待文章编辑器就绪；文章页经常没有视频上传区，所以优先走 articleReadySelector。 */
export async function waitForArticleEditorReady(config: PlatformConfig) {
  // 优先使用文章专用就绪选择器
  if (config.articleReadySelector) {
    const ready = await waitForSelector(config.articleReadySelector, DEFAULT_EDITOR_READY_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`文章编辑器未就绪：${config.articleReadySelector}`);
    }
    return config.articleReadySelector;
  }
  return waitForEditorReadyWithUpload(config, config.articleUpload || config.upload);
}

/** 等待图文编辑器就绪；图文复用 articleUpload 配置，因为它也是“先上传图片再填文本”。 */
export async function waitForImageEditorReady(config: PlatformConfig) {
  return waitForEditorReadyWithUpload(config, config.articleUpload || config.upload);
}

/** 用上传配置里的 editorReadySelector 统一等待视频/图文上传后的编辑态。 */
async function waitForEditorReadyWithUpload(config: PlatformConfig, uploadConfig: PlatformConfig['upload'] | PlatformConfig['articleUpload']) {
  const readySelector = uploadConfig?.editorReadySelector || config.readySelector;
  const editorReady = await waitForSelector(readySelector, uploadConfig?.timeoutMs || DEFAULT_EDITOR_READY_TIMEOUT_MS);
  if (!editorReady) {
    throw new Error(`上传后没有等到可填写区域：${readySelector}`);
  }
  return readySelector;
}

/** 合并上传、封面、正文填充的阶段性结果，给侧边栏展示统一状态文案。 */
export function composePublishMessage(uploadMessage = '', coverMessage = '', articleBodyMessage = '') {
  return `${uploadMessage || ''}${coverMessage || ''}${articleBodyMessage || ''}文本已填充，请检查后发布。`;
}

/** 按按钮文本查找可见按钮，处理确认弹窗、声明弹窗、下拉确认等公共场景。 */
function findVisibleButtonByText(
  texts: string[],
  selector = 'button, [role="button"]',
  options: { exact?: boolean; requireEnabled?: boolean } = {},
): HTMLElement | null {
  const exact = options.exact ?? true;
  const requireEnabled = options.requireEnabled ?? false;
  const buttons = document.querySelectorAll<HTMLElement>(selector);
  for (const button of buttons) {
    const text = button.textContent?.trim() || '';
    const matched = exact
      ? texts.includes(text)
      : texts.some((target) => text.includes(target));
    if (!matched || button.offsetParent === null) continue;
    if (requireEnabled && button.hasAttribute('disabled')) continue;
    return button;
  }
  return null;
}

/** 判断元素是否能点击；用于过滤 SVG、文本节点或不可交互容器。 */
function isClickableElement(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.click === 'function';
}

/** 查询一组可点击元素，并过滤成 HTMLElement。 */
function queryClickableElements(selector: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector))
    .filter(isClickableElement);
}

/** 填充“谁可以看/可见范围”，兼容 radio 和 dropdown 两类平台控件。 */
export async function fillVisibility(config: PlatformConfig, visibility: string) {
  if (!config.fields.visibility) return;

  const visibilityMap: Record<string, string> = {
    public: '公开',
    friends: '好友',
    private: '仅自己',
  };

  const targetText = visibilityMap[visibility] || '公开';
  const { 触发器, 类型, 选项选择器 } = config.fields.visibility;

  if (类型 === 'radio') {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    for (const input of inputs) {
      const parent = input.closest('label') || input.parentElement;
      const text = parent?.textContent?.trim() || '';
      if (text.includes(targetText) && input.offsetParent !== null) {
        input.click();
        return;
      }
    }
    return;
  }

  if (类型 === 'dropdown') {
    const trigger = querySelectorDeep(触发器);
    if (isClickableElement(trigger)) {
      trigger.click();
      await humanDelay(300);
      const options = document.querySelectorAll(选项选择器 || '[class*="option"], [class*="dropdown-item"]');
      for (const option of options) {
        if (option.textContent?.includes(targetText) && isClickableElement(option)) {
          option.click();
          return;
        }
      }
    }
  }
}

/** 在页面中定位定时发布区域，优先按定时关键字和小时/分钟 combobox 聚合。 */
function findScheduledSection(): HTMLElement | null {
  const candidates = queryClickableElements(
    '[class*="schedule"], [class*="Schedule"], [class*="timer"], [class*="Timer"], [class*="publish-time"], [class*="PublishTime"]',
  );
  for (const el of candidates) {
    if (el.textContent?.includes('定时')) return el;
  }

  const visited = new Set<HTMLElement>();
  const comboButtons = queryClickableElements('button[role="combobox"]');
  for (const button of comboButtons) {
    let el = button.parentElement;
    for (let depth = 0; el && depth < 8; depth++) {
      if (!visited.has(el)) {
        visited.add(el);
        if (el.textContent?.includes('定时发布') && el.querySelectorAll('button[role="combobox"]').length >= 2) {
          return el;
        }
      }
      el = el.parentElement;
    }
  }
  return null;
}

/** 将时间戳拆成日期、小时、分钟和字符串，供不同控件类型复用。 */
function getScheduledDateParts(scheduledAt: number) {
  const date = new Date(scheduledAt);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return {
    date,
    hours,
    minutes,
    dateStr,
    timeStr,
  };
}

/** B站定时发布只允许 5 分钟步进，所以必须向上取到最近可选分钟。 */
function getSteppedTimerDateParts(date: Date) {
  const steppedDate = new Date(date.getTime());
  const minutes = steppedDate.getMinutes();
  const steppedMinutes = Math.ceil(minutes / TIME_PICKER_MINUTE_STEP) * TIME_PICKER_MINUTE_STEP;
  steppedDate.setMinutes(steppedMinutes, 0, 0);
  return {
    date: steppedDate,
    hours: steppedDate.getHours(),
    minutes: steppedDate.getMinutes(),
  };
}

/** 通过原生 value setter 写 input，保证 React/Vue 受控组件能收到 input/change。 */
function setNativeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 打开定时发布控件，兼容 radio、switch、checkbox 以及 B站自定义 switch 卡片。 */
async function enableScheduledControl(触发器: string, 类型: string) {
  if (类型 === 'radio') {
    const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    for (const radio of radios) {
      const parent = radio.closest('label') || radio.parentElement;
      const text = parent?.textContent?.trim() || '';
      if (text.includes('定时') && !text.includes('不定') && !radio.checked) {
        radio.click();
        await humanDelay(500);
        break;
      }
    }
  } else if (类型 === 'switch' || 类型 === 'checkbox') {
    const cards = document.querySelectorAll<HTMLElement>('.custom-switch-card, [class*="switch-card"]');
    let found = false;
    for (const card of cards) {
      const text = card.textContent?.trim() || '';
      if (text.includes('定时')) {
        const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (checkbox?.checked) {
          found = true;
          break;
        }
        const simulator = card.querySelector<HTMLElement>('.d-switch-simulator');
        if (simulator) {
          simulator.click();
          found = true;
          await humanDelay(500);
          break;
        }
        const icon = card.querySelector<HTMLElement>('.custom-switch-icon');
        if (icon) {
          icon.click();
          found = true;
          await humanDelay(500);
          break;
        }
        card.click();
        found = true;
        await humanDelay(500);
        break;
      }
    }

    if (!found) {
      const allCheckboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      for (const cb of allCheckboxes) {
        const parent = cb.closest('label') || cb.parentElement;
        const grandparent = parent?.parentElement;
        const text = (parent?.textContent?.trim() || '') + ' ' + (grandparent?.textContent?.trim() || '');
        if (text.includes('定时') && !text.includes('不定时') && !cb.checked) {
          cb.click();
          found = true;
          await humanDelay(300);
          break;
        }
      }
    }

    if (!found) {
      const triggers = 触发器.split(',').map((s) => s.trim());
      for (const selector of triggers) {
        if (found) break;
        const elements = queryClickableElements(selector);
        for (const el of elements) {
          if (el.offsetParent === null) continue;
          // 如果控件已处于激活态（如 B站 .switch-container-active），不再点击，避免误关闭
          if (isSwitchAlreadyActive(el)) {
            found = true;
            break;
          }
          el.click();
          found = true;
          await humanDelay(300);
          break;
        }
      }
    }
  }
}

/** 判断开关是否已经打开，避免重复点击把 B站/快手开关又关掉。 */
function isSwitchAlreadyActive(el: HTMLElement): boolean {
  if (el.className?.toString().includes('active') || el.className?.toString().includes('checked')) {
    return true;
  }
  const parent = el.parentElement;
  if (parent && (parent.className?.toString().includes('active') || parent.className?.toString().includes('checked'))) {
    return true;
  }
  return false;
}

/** 填充 Ant Design 的只读日期时间选择器，主要用于使用弹层选择而不能直接输入的平台。 */
async function fillReadonlyAntPicker(timeInput: HTMLInputElement, date: Date, hours: number, minutes: number) {
  timeInput.focus();
  timeInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await humanDelay(ANT_PICKER_OPEN_DELAY_MS);

  const targetDay = date.getDate();
  const dateCells = queryClickableElements('.ant-picker-cell');
  for (const cell of dateCells) {
    const cellText = cell.textContent?.trim() || '';
    if (cellText === String(targetDay) && !cell.classList.contains('ant-picker-cell-disabled')) {
      cell.click();
      await humanDelay(ANT_PICKER_SELECTION_SETTLE_MS);
      break;
    }
  }

  const timeColumns = queryClickableElements('.ant-picker-time-panel-column');
  const targetValues = [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    '00',
  ];
  for (let i = 0; i < Math.min(timeColumns.length, targetValues.length); i++) {
    const col = timeColumns[i];
    const cells = queryClickableElements('.ant-picker-time-panel-cell', col);
    for (const cell of cells) {
      if (cell.textContent?.trim() === targetValues[i]) {
        cell.click();
        await humanDelay(ANT_PICKER_TIME_SELECTION_SETTLE_MS);
        break;
      }
    }
  }

  const confirmButton = findVisibleButtonByText(['确定'], 'button');
  if (confirmButton) {
    confirmButton.click();
    await humanDelay(ANT_PICKER_SELECTION_SETTLE_MS);
  }
}

/** 填充 B站类自定义 date/time picker，小时分钟分别在两个滚动列里选择。 */
async function fillTimerDatePicker(timeEl: HTMLElement, date: Date) {
  const timerParts = getSteppedTimerDateParts(date);
  const targetDate = timerParts.date;
  const targetHours = timerParts.hours;
  const targetMinutes = timerParts.minutes;

  const datePickerEl = document.querySelector<HTMLElement>('.date-picker-date, .date-input, .date-picker-wrapper');
  if (datePickerEl) {
    datePickerEl.click();
    await humanDelay(TIMER_PICKER_OPEN_DELAY_MS);

    const navTitle = document.querySelector<HTMLElement>('.date-picker-nav-title');
    if (navTitle) {
      const titleText = navTitle.textContent?.trim() || '';
      if (!titleText.includes(String(targetDate.getMonth() + 1) + '月')) {
        const nextBtn = document.querySelector<HTMLElement>('.next-btn-day, .next-btn-month');
        if (nextBtn) {
          nextBtn.click();
          await humanDelay(TIMER_PICKER_NAVIGATION_SETTLE_MS);
        }
      }
    }

    const dayItems = queryClickableElements('.date-picker-body-item');
    const targetDay = String(targetDate.getDate());
    for (const item of dayItems) {
      if (item.textContent?.trim() === targetDay &&
        !item.classList.contains('date-item-disabled') &&
        !item.classList.contains('date-select-disabled')) {
        item.click();
        await humanDelay(TIMER_PICKER_SELECTION_SETTLE_MS);
        break;
      }
    }
  }

  const timePickerEl = document.querySelector<HTMLElement>('.time-input, .time-picker-wrapper') || timeEl;
  timePickerEl.click();
  await humanDelay(TIMER_PICKER_OPEN_DELAY_MS);

  const panels = queryClickableElements('.time-picker-panel-select-wrp');
  if (panels.length >= 2) {
    const hourItems = queryClickableElements('.time-picker-panel-select-item', panels[0]);
    const targetHour = String(targetHours).padStart(2, '0');
    for (const item of hourItems) {
      if (item.textContent?.trim() === targetHour && !item.classList.contains('time-select-disabled')) {
        item.click();
        await humanDelay(TIMER_PICKER_SELECTION_SETTLE_MS);
        break;
      }
    }

    const minuteItems = queryClickableElements('.time-picker-panel-select-item', panels[1]);
    const targetMinute = String(targetMinutes).padStart(2, '0');
    for (const item of minuteItems) {
      if (item.textContent?.trim() === targetMinute && !item.classList.contains('time-select-disabled')) {
        item.click();
        await humanDelay(TIMER_PICKER_SELECTION_SETTLE_MS);
        break;
      }
    }
  }

  await humanDelay(TIMER_PICKER_SELECTION_SETTLE_MS);
}

/** 填充定时发布字段，统一处理直接 input、只读 Ant Picker、B站自定义 picker 和 combobox。 */
export async function fillScheduled(config: PlatformConfig, scheduledAt: number) {
  if (!config.fields.scheduled || !scheduledAt) return;

  const { 触发器, 类型, 时间输入, 日期输入 } = config.fields.scheduled;

  await enableScheduledControl(触发器, 类型);

  const { date, hours, minutes, dateStr, timeStr } = getScheduledDateParts(scheduledAt);

  if (日期输入) {
    const dateInput = querySelectorDeep(日期输入);
    if (dateInput instanceof HTMLInputElement) {
      setNativeInputValue(dateInput, dateStr);
    }
  }

  if (时间输入) {
    const timeInput = querySelectorDeep(时间输入);
    if (timeInput instanceof HTMLInputElement) {
      if (timeInput.readOnly) {
        await fillReadonlyAntPicker(timeInput, date, hours, minutes);
      } else {
        const currentValue = timeInput.value || '';
        const datetimeStr = currentValue.includes('-') ? `${dateStr} ${timeStr}` : timeStr;
        setNativeInputValue(timeInput, datetimeStr);
      }
    } else {
      const timeEl = querySelectorDeep(时间输入);
      if (timeEl && !isClickableElement(timeEl)) return;
      if (!timeEl) return;

      const timeElClass = timeEl.classList.toString();
      if (
        timeElClass.includes('timer') ||
        timeElClass.includes('date-picker') ||
        timeElClass.includes('date-time-picker') ||
        timeElClass.includes('date-input') ||
        timeElClass.includes('time-input')
      ) {
        await fillTimerDatePicker(timeEl, date);
        return;
      }

      const scheduleSection = findScheduledSection();
      const comboSource = scheduleSection
        ? queryClickableElements(时间输入, scheduleSection)
        : queryClickableElements(时间输入);
      const combos = Array.from(comboSource).filter((el) => {
        if (!el.offsetParent) return false;
        const val = el.getAttribute('value') || el.textContent?.trim() || '';
        return /^\d{1,2}$/.test(val) && parseInt(val) < 60;
      });

      const timeComboPairs: Array<{ el: HTMLElement; target: string }> = [];
      if (combos.length >= 2) {
        timeComboPairs.push(
          { el: combos[0], target: String(hours).padStart(2, '0') },
          { el: combos[1], target: String(minutes).padStart(2, '0') },
        );
      } else if (combos.length === 1) {
        const comboText = combos[0].getAttribute('value') || combos[0].textContent?.trim() || '';
        const isHour = /^\d{1,2}$/.test(comboText) && parseInt(comboText) < 24;
        timeComboPairs.push({
          el: combos[0],
          target: isHour ? String(hours).padStart(2, '0') : String(minutes).padStart(2, '0'),
        });
      }

      for (const { el, target } of timeComboPairs) {
        const comboText = el.getAttribute('value') || el.textContent?.trim() || '';
        if (comboText === target) continue;

        el.click();
        await humanDelay(500);
        const optionSelectors = ['[role="option"]', '[role="menuitem"]', '[class*="option"]'];
        let optionClicked = false;
        for (const selector of optionSelectors) {
          if (optionClicked) break;
          const options = queryClickableElements(selector);
          for (const opt of options) {
            const optText = opt.textContent?.trim() || '';
            if (optText === target && opt.offsetParent !== null) {
              opt.click();
              await humanDelay(300);
              optionClicked = true;
              break;
            }
          }
        }
      }
    }
  }
}

/** 勾选原创/声明开关，并处理可能弹出的“已阅读并同意”确认弹窗。 */
export async function fillOriginalDeclare(config: PlatformConfig) {
  if (!config.fields.originalDeclare) return;

  const { 触发器, 类型 } = config.fields.originalDeclare;

  if (类型 === 'checkbox') {
    let targetCheckbox: HTMLInputElement | null = null;
    const allCheckboxes = document.querySelectorAll<HTMLInputElement>(触发器);
    for (const cb of allCheckboxes) {
      const parent = cb.closest('label') || cb.parentElement;
      const grandparent = parent?.parentElement;
      const text = (parent?.textContent?.trim() || '') + ' ' + (grandparent?.textContent?.trim() || '');
      if (text.includes('原创') || text.includes('声明')) {
        targetCheckbox = cb;
        break;
      }
    }
    if (!targetCheckbox) {
      targetCheckbox = querySelectorDeep(触发器) as HTMLInputElement | null;
    }
    if (targetCheckbox && !targetCheckbox.checked) {
      targetCheckbox.click();
      await humanDelay(800);
    }

    await handleOriginalDeclarePopup();
  } else if (类型 === 'toggle' || 类型 === 'switch') {
    const cards = document.querySelectorAll<HTMLElement>('.custom-switch-card, [class*="switch-card"]');
    for (const card of cards) {
      const text = card.textContent?.trim() || '';
      if (text.includes('原创')) {
        const simulator = card.querySelector<HTMLElement>('.d-switch-simulator');
        if (simulator) {
          simulator.click();
          await humanDelay(800);
          await handleOriginalDeclarePopup();
          return;
        }
        const icon = card.querySelector<HTMLElement>('.custom-switch-icon');
        if (icon) {
          icon.click();
          await humanDelay(800);
          await handleOriginalDeclarePopup();
          return;
        }
        card.click();
        await humanDelay(800);
        await handleOriginalDeclarePopup();
        return;
      }
    }

    const triggers = 触发器.split(',').map((s) => s.trim());
    for (const selector of triggers) {
      const elements = queryClickableElements(selector);
      for (const el of elements) {
        if (el.offsetParent !== null) {
          const text = el.textContent?.trim() || '';
          if (text.includes('原创')) {
            if (isSwitchAlreadyActive(el)) return;
            el.click();
            await humanDelay(800);
            await handleOriginalDeclarePopup();
            return;
          }
        }
      }
    }
    for (const selector of triggers) {
      const elements = queryClickableElements(selector);
      for (const el of elements) {
        if (el.offsetParent !== null) {
          if (isSwitchAlreadyActive(el)) return;
          el.click();
          await humanDelay(800);
          await handleOriginalDeclarePopup();
          return;
        }
      }
    }
  }
}

/** 处理原创声明弹窗中的同意勾选和最终确认按钮。 */
export async function handleOriginalDeclarePopup() {
  await humanDelay(500);
  const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const parent = cb.closest('label') || cb.parentElement;
    const grandparent = parent?.parentElement;
    const text = (parent?.textContent?.trim() || '') + ' ' + (grandparent?.textContent?.trim() || '');
    if ((text.includes('已阅读') || text.includes('已同意') || text.includes('同意《')) && !cb.checked) {
      cb.click();
      await humanDelay(500);
    }
  }
  await humanDelay(300);
  const declareButton = findVisibleButtonByText(['声明原创'], 'button, [role="button"]', {
    requireEnabled: true,
  });
  if (declareButton) {
    declareButton.click();
    await humanDelay(300);
  }
}

/** 填充平台声明/视频标记下拉项，兼容按钮弹窗、radio 弹窗和普通 option 列表。 */
export async function fillDeclarationDropdown(config: PlatformConfig, targetText: string) {
  const declConfig = config.fields.declaration || config.fields.originalDeclare;
  if (!declConfig) return;

  if (declConfig.类型 === 'button') {
    let targetBtn: HTMLElement | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const buttons = queryClickableElements('button, [role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        if (text === targetText && btn.offsetParent !== null) {
          targetBtn = btn;
          break;
        }
      }
      if (targetBtn) break;
      await humanDelay(500);
    }
    if (!targetBtn) return;

    targetBtn.click();
    await humanDelay(500);
    const confirmButton = findVisibleButtonByText(['确定']);
    if (confirmButton) {
      confirmButton.click();
    }
    return;
  }

  if (declConfig.类型 !== 'dropdown') return;

  const triggers = declConfig.触发器.split(',').map((s) => s.trim());
  let trigger: HTMLElement | null = null;
  for (const selector of triggers) {
    const all = queryClickableElements(selector);
    const visible = Array.from(all).filter((el) => el.offsetParent !== null);
    if (visible.length === 0) continue;
    if (visible.length === 1) {
      trigger = visible[0];
    } else {
      const keywords = ['标记', '声明', '标注', '创作声明', targetText];
      trigger = visible.find((el) => {
        const t = el.textContent?.trim() || '';
        const v = el.getAttribute('value') || '';
        return keywords.some((k) => t.includes(k) || v.includes(k));
      }) || visible[0];
    }
    if (trigger) break;
  }
  if (!trigger) return;

  trigger.click();
  await humanDelay(600);

  const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  const matchedRadios: HTMLInputElement[] = [];
  for (const radio of radios) {
    const parent = radio.closest('label') || radio.parentElement;
    const text = parent?.textContent?.trim() || '';
    if (text.includes(targetText) || targetText.includes(text)) {
      matchedRadios.push(radio);
    }
  }
  if (matchedRadios.length > 0) {
    const radio = matchedRadios[0];
    if (!radio.checked) {
      radio.click();
      await humanDelay(300);
    }
    const confirmButton = findVisibleButtonByText(['确定'], 'button, [role="button"]', {
      requireEnabled: true,
    });
    if (confirmButton) {
      confirmButton.click();
    }
    return;
  }

  const optionSelectors = [
    'li.bcc-option',
    '[role="option"]',
    '[class*="option"]',
    '[class*="dropdown-item"]',
    'li[class*="item"]',
    '[class*="select-item"]',
    '[class*="menu-item"]',
  ];
  for (const selector of optionSelectors) {
    const options = queryClickableElements(selector);
    for (const option of options) {
      const text = option.textContent?.trim() || '';
      if (text === targetText || text.includes(targetText)) {
        option.click();
        await humanDelay(300);
        const confirmTexts = ['确认', '确定', 'OK', '确认选择'];
        const confirmButton = findVisibleButtonByText(confirmTexts, 'button, [role="button"]', {
          requireEnabled: true,
        });
        if (confirmButton) {
          confirmButton.click();
        }
        return;
      }
    }
  }

  const allClickable = queryClickableElements(
    'li, [role="option"], [role="menuitem"], [class*="item"], [class*="option"], button',
  );
  for (const el of allClickable) {
    const text = el.textContent?.trim() || '';
    if (text === targetText && el.offsetParent !== null) {
      el.click();
      await humanDelay(300);
      const confirmTexts = ['确认', '确定', 'OK', '确认选择'];
      const confirmButton = findVisibleButtonByText(confirmTexts, 'button, [role="button"]', {
        requireEnabled: true,
      });
      if (confirmButton) {
        confirmButton.click();
      }
      return;
    }
  }
}

/** 填充平台个性化设置；公共字段在这里分发到各平台专用的控件处理。 */
export async function fillPlatformSettings(config: PlatformConfig, settings: Record<string, unknown>) {
  const platformId = config.id;

  if (platformId === 'bilibili' && settings.commercialPromotion !== false) {
    const checkboxWrappers = queryClickableElements('.video-porder-check-wrp, label.bcc-checkbox');
    for (const wrapper of checkboxWrappers) {
      const text = wrapper.textContent?.trim() || '';
      if (text.includes('商业推广') || text.includes('增加商业')) {
        const checkbox = wrapper.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (checkbox && !checkbox.checked) {
          checkbox.click();
        } else if (!checkbox) {
          wrapper.click();
        }
        break;
      }
    }
  }

  if ('declaration' in settings && typeof settings.declaration === 'string') {
    await fillDeclarationDropdown(config, settings.declaration);
  }

  if (platformId === 'kuaishou' && 'allowDuet' in settings) {
    await toggleKuaishouCheckbox('同框', settings.allowDuet as boolean);
  }

  if (platformId === 'kuaishou' && 'allowDownload' in settings) {
    await toggleKuaishouCheckbox('下载', settings.allowDownload as boolean);
  }
}

/** 切换快手“允许同框/允许下载”等 checkbox，按文案定位避免依赖易变 class。 */
async function toggleKuaishouCheckbox(keyword: string, shouldBeChecked: boolean) {
  const labels = queryClickableElements('label, [class*="checkbox"], [class*="switch"]');
  for (const label of labels) {
    const text = label.textContent?.trim() || '';
    if (!text.includes(keyword)) continue;

    const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) {
      if (checkbox.checked !== shouldBeChecked) {
        checkbox.click();
      }
      return;
    }

    if (shouldBeChecked) {
      label.click();
    }
    return;
  }
}
