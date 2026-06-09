import MarkdownIt from 'markdown-it';
import {
  dispatchClipboardEvent,
  findEditableElement,
  getActiveDocument,
  scrollIntoView,
  selectExistingText,
  waitForIdle,
} from './dom';
import { humanDelay } from './fieldFiller';
import type { FieldConfig } from '../platforms';

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

export interface ArticleImage {
  alt: string;
  src: string;
  isBase64: boolean;
}

/**
 * 从 Markdown 中提取所有图片信息。
 */
export function extractImages(markdown: string): ArticleImage[] {
  const images: ArticleImage[] = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    images.push({
      alt: match[1],
      src: match[2],
      isBase64: match[2].startsWith('data:'),
    });
  }
  return images;
}

/**
 * 从 Markdown 中提取 base64 图片并转为 File 对象，返回清理后的 Markdown。
 * 处理两种格式：
 *   1. 内联：![alt](data:...)
 *   2. 引用定义：[img-N]: data:...
 */
export async function extractBase64ImagesAsFiles(markdown: string): Promise<{ cleanedMarkdown: string; files: File[] }> {
  const files: File[] = [];
  let index = 0;

  // 处理内联格式 ![alt](data:...)
  let cleaned = markdown.replace(
    /!\[([^\]]*)\]\((data:[^)]+)\)/g,
    (_match, alt, dataUrl) => {
      const file = dataUrlToFile(dataUrl, `article-img-${++index}.png`);
      if (file) files.push(file);
      return `![${alt}](uploaded-${index})`;
    },
  );

  // 处理引用定义格式 [img-N]: data:...
  cleaned = cleaned.replace(
    /^\[([^\]]+)\]:\s*(data:.+)$/gm,
    (_match, ref, dataUrl) => {
      const file = dataUrlToFile(dataUrl.trim(), `article-img-${++index}.png`);
      if (file) files.push(file);
      return `[${ref}]: uploaded-${index}`;
    },
  );

  return { cleanedMarkdown: cleaned, files };
}

/**
 * 将 data URL 转为 File 对象。
 */
function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const [header, body] = dataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mime });
  } catch {
    return null;
  }
}

/**
 * 从 Markdown 中提取标题（第一个 # 标题）。
 */
export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * 将 Markdown 转换为 HTML。
 */
export function markdownToHtml(markdown: string): string {
  return md.render(markdown);
}

/**
 * 将 Markdown 正文填充到 contenteditable 编辑器中。
 * 支持 ProseMirror（小红书、B站、微博、抖音）和 Draft.js（知乎）编辑器。
 *
 * @param field - 文章正文的字段配置（包含选择器）
 * @param markdown - 原始 Markdown 内容
 * @returns 操作结果消息
 */
export async function fillArticleBody(field: FieldConfig, markdown: string): Promise<string> {
  console.info('[PubFlow] fillArticleBody start', {
    selectors: field.selectors,
    markdownLength: markdown.length,
  });

  const element = findEditableElement(field.selectors);
  if (!element) {
    console.warn('[PubFlow] fillArticleBody: element not found', { selectors: field.selectors });
    return `没有找到文章正文编辑区：${field.selectors[0]}`;
  }

  console.info('[PubFlow] fillArticleBody: element found', {
    tag: element.tagName,
    contentEditable: element.contentEditable,
    classList: element.className?.slice?.(0, 100),
  });

  scrollIntoView(element);
  await humanDelay(300, 600);

  const html = markdownToHtml(markdown);

  const editable = findContentEditable(element);
  if (!editable) {
    console.warn('[PubFlow] fillArticleBody: no contenteditable element found', { element });
    return '文章正文编辑区不是 contenteditable 元素。';
  }

  editable.focus();
  await waitForIdle(200);

  // ProseMirror 编辑器需要通过 API 注入，innerHTML 不会同步内部状态
  const pmResult = await fillProseMirror(editable, html);
  if (pmResult) {
    console.info('[PubFlow] fillArticleBody: ProseMirror fill succeeded');
    return '文章正文已填充（ProseMirror）。';
  }

  console.info('[PubFlow] fillArticleBody: ProseMirror not detected, falling back to execCommand');

  // 通用 contenteditable（Draft.js 等）：用 selectAll + insertHTML 替换内容
  // 注意：不能用 innerHTML='' 清空，这会破坏 ProseMirror/Tiptap 的内部状态
  const activeDocument = getActiveDocument(editable);
  activeDocument.execCommand('selectAll', false);
  const inserted = activeDocument.execCommand('insertHTML', false, html);
  if (!inserted) {
    editable.innerHTML = html;
  }

  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(300);

  console.info('[PubFlow] fillArticleBody: execCommand fill completed');
  return '文章正文已填充。';
}

/**
 * 尝试通过 Tiptap / ProseMirror API 注入 HTML。
 * ProseMirror 维护独立的文档状态，直接修改 innerHTML 不会同步。
 */
async function fillProseMirror(editable: HTMLElement, html: string): Promise<boolean> {
  // 1. 优先使用 Tiptap Editor API（element.editor.commands.setContent）
  // 现代 Tiptap 把编辑器实例挂在 DOM 元素的 .editor 属性上
  const tiptapEditor = findTiptapEditor(editable);
  if (tiptapEditor) {
    try {
      tiptapEditor.commands.setContent(html);
      return true;
    } catch {
      // Tiptap setContent 失败，继续尝试其他方式
    }
  }

  // 2. 回退：尝试旧版 ProseMirror pmViewDesc.view
  const view = findProseMirrorView(editable);
  if (view) {
    try {
      const parser = (DOMParser as any).fromSchema?.(view.state.schema);
      if (parser) {
        const container = document.createElement('div');
        container.innerHTML = html;
        const doc = parser.parse(container);
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
        view.dispatch(tr);
        return true;
      }
    } catch {
      // ProseMirror API 失败
    }
  }

  return false;
}

/**
 * 查找 Tiptap 编辑器实例。
 * Tiptap 将编辑器实例挂在 .tiptap.ProseMirror 元素的 .editor 属性上。
 */
function findTiptapEditor(element: HTMLElement): any {
  const candidates = [element, ...Array.from(element.querySelectorAll('.ProseMirror, .tiptap'))] as HTMLElement[];
  for (const el of candidates) {
    const editor = (el as any).editor;
    if (editor?.commands?.setContent) return editor;
  }
  return null;
}

/**
 * 查找旧版 ProseMirror view 实例。
 * B站专栏、小红书长文等编辑器可能不暴露 Tiptap API，只能从 pmViewDesc 回到 ProseMirror 状态层写入。
 */
function findProseMirrorView(element: HTMLElement): any {
  const candidates = [element, ...Array.from(element.querySelectorAll('.ProseMirror'))] as HTMLElement[];
  for (const el of candidates) {
    const desc = (el as any).pmViewDesc;
    if (desc?.view) return desc.view;
  }
  return null;
}

/**
 * 用纯文本模式填充文章正文（用于支持原生 Markdown 的平台如知乎）。
 * 直接设置 innerText，平台会自动解析 Markdown 语法。
 */
export async function fillArticleBodyAsText(field: FieldConfig, markdown: string): Promise<string> {
  const element = findEditableElement(field.selectors);
  if (!element) {
    return `没有找到文章正文编辑区：${field.selectors[0]}`;
  }

  scrollIntoView(element);
  await humanDelay(300, 600);

  const editable = findContentEditable(element);
  if (!editable) {
    return '文章正文编辑区不是 contenteditable 元素。';
  }

  editable.focus();
  await waitForIdle(200);

  const draftFilled = await fillDraftEditorAsText(editable, markdown);
  if (draftFilled) {
    return '文章正文已填充（Draft.js 纯文本模式）。';
  }

  // 清空并设置纯文本。这里必须选中目标 editable，而不是依赖全局 selectAll，
  // 否则页面上有弹窗/iframe 时选区可能落在错误节点。
  const activeDocument = getActiveDocument(editable);
  selectExistingText(editable);
  activeDocument.execCommand('insertText', false, markdown);
  await waitForIdle(200);

  const insertedText = editable.textContent || '';
  const appearsTruncated =
    markdown.includes('\n') &&
    insertedText.trim() &&
    !insertedText.includes('\n') &&
    insertedText.trim().length < markdown.trim().length * 0.6;

  if (appearsTruncated) {
    activeDocument.execCommand('selectAll', false);
    activeDocument.execCommand('delete', false);
    dispatchClipboardEvent(editable, markdown);
    await waitForIdle(200);
    if (!hasExpectedText(editable, markdown)) {
      activeDocument.execCommand('selectAll', false);
      activeDocument.execCommand('delete', false);
      await insertPlainTextByParagraph(editable, markdown);
    }
  }

  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(300);

  return '文章正文已填充（纯文本模式）。';
}

/**
 * 按“纯文本段落”填充文章正文，主要用于 B站专栏这类对 HTML 换行很敏感的平台。
 * 这里先把 Markdown 清理成普通文本，再按段落插入，避免一个换行被平台渲染成两段大间距。
 */
export async function fillArticleBodyPlainParagraphs(field: FieldConfig, markdown: string): Promise<string> {
  const element = findEditableElement(field.selectors);
  if (!element) {
    return `没有找到文章正文编辑区：${field.selectors[0]}`;
  }

  scrollIntoView(element);
  await humanDelay(300, 600);

  const editable = findContentEditable(element);
  if (!editable) {
    return '文章正文编辑区不是 contenteditable 元素。';
  }

  editable.focus();
  await waitForIdle(200);

  const plainText = normalizeArticlePlainText(markdown);
  const pmResult = await fillProseMirrorPlainText(editable, plainText);
  if (pmResult) {
    return '文章正文已填充（ProseMirror 纯文本）。';
  }

  selectExistingText(editable);
  getActiveDocument(editable).execCommand('delete', false);
  await insertPlainTextByParagraph(editable, plainText);
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(300);
  return '文章正文已填充（纯文本段落）。';
}

/**
 * 通过 Draft.js 可识别的粘贴/段落插入流程填充正文。
 * 知乎专栏是 Draft.js，直接 innerText 或 insertText 容易只进第一行或丢失空行，所以需要分层回退。
 */
async function fillDraftEditorAsText(editable: HTMLElement, markdown: string) {
  if (!isDraftEditor(editable)) return false;

  const plainText = normalizeArticlePlainText(markdown);
  const activeDocument = getActiveDocument(editable);
  editable.focus();
  await waitForIdle(100);
  selectExistingText(editable);
  activeDocument.execCommand('delete', false);
  await waitForIdle(100);

  dispatchClipboardEvent(editable, plainText);
  await waitForIdle(400);
  if (hasExpectedText(editable, plainText)) return true;

  const handledByReactPaste = callReactPasteHandler(editable, plainText);
  if (handledByReactPaste) {
    await waitForIdle(500);
    if (hasExpectedText(editable, plainText)) return true;
  }

  selectExistingText(editable);
  activeDocument.execCommand('delete', false);
  await insertPlainTextByParagraph(editable, plainText);
  await waitForIdle(300);
  return hasExpectedText(editable, plainText);
}

/** 判断目标编辑区是否是 Draft.js，用来走知乎专栏的专用填充路径。 */
function isDraftEditor(editable: HTMLElement) {
  return Boolean(
    editable.classList.contains('public-DraftEditor-content') ||
    editable.closest('.DraftEditor-root, .DraftEditor-editorContainer'),
  );
}

/**
 * 直接调用 React 绑定的 onPaste 处理器。
 * Draft.js 的真实状态在 React 内部，触发它自己的粘贴逻辑比只派发 DOM 事件更稳定。
 */
function callReactPasteHandler(editable: HTMLElement, markdown: string) {
  const props = getReactProps(editable);
  const onPaste = props?.onPaste;
  if (typeof onPaste !== 'function') return false;

  const data = new DataTransfer();
  data.setData('text/plain', markdown);
  const nativeEvent = new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  const syntheticEvent = {
    nativeEvent,
    clipboardData: data,
    preventDefault: () => nativeEvent.preventDefault(),
    stopPropagation: () => nativeEvent.stopPropagation(),
    isDefaultPrevented: () => nativeEvent.defaultPrevented,
  };

  try {
    onPaste(syntheticEvent);
    return true;
  } catch {
    return false;
  }
}

/** 读取 React 挂在 DOM 节点上的 props，供 Draft.js 粘贴处理器复用。 */
function getReactProps(element: HTMLElement): Record<string, unknown> | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps'));
  return key ? ((element as any)[key] as Record<string, unknown>) : null;
}

/** 粗略校验正文是否真的进入编辑器，避免平台吞掉换行后误判为成功。 */
function hasExpectedText(editable: HTMLElement, markdown: string) {
  const actual = (editable.textContent || '').replace(/\s+/g, '');
  const expected = markdown.replace(/\s+/g, '');
  return expected.length > 0 && actual.length >= expected.length * 0.75;
}

/**
 * 按行逐段插入纯文本。
 * 这是最后兜底路径：比一次性 paste 慢，但能绕过知乎/B站对多行文本的截断或换行合并。
 */
async function insertPlainTextByParagraph(editable: HTMLElement, markdown: string) {
  const activeDocument = getActiveDocument(editable);
  const paragraphs = markdown.replace(/\r\n?/g, '\n').split('\n');

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index].trimEnd();
    if (paragraph) {
      activeDocument.execCommand('insertText', false, paragraph);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: paragraph, inputType: 'insertText' }));
      await waitForIdle(40);
    }
    if (index < paragraphs.length - 1) {
      activeDocument.execCommand('insertParagraph', false);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: null, inputType: 'insertParagraph' }));
      await waitForIdle(40);
    }
  }
}

/**
 * 用 ProseMirror schema 构造纯文本文档。
 * B站文章编辑器直接操作 DOM 会产生额外空段落，通过 schema 写状态可以保留预期换行。
 */
async function fillProseMirrorPlainText(editable: HTMLElement, text: string): Promise<boolean> {
  const view = findProseMirrorView(editable);
  const schema = view?.state?.schema;
  if (!view || !schema?.nodes?.doc || !schema?.nodes?.paragraph || !schema?.text) return false;

  try {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const paragraphs = lines.map((line) => {
      const content = line ? [schema.text(line.trimEnd())] : undefined;
      return schema.nodes.paragraph.create(null, content);
    });
    const doc = schema.nodes.doc.create(null, paragraphs);
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    view.dispatch(tr);
    view.focus?.();
    await waitForIdle(200);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将 Markdown 转成平台文章编辑器更容易接受的普通文本。
 * 这里保留有限空行，去掉标题/图片/链接语法，避免专栏编辑器把 Markdown 标记当正文噪声。
 */
function normalizeArticlePlainText(markdown: string) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\[img-\d+\]:\s*.+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * 在元素或其子元素中查找 contenteditable 元素。
 */
function findContentEditable(element: Element): HTMLElement | null {
  if (element.getAttribute('contenteditable') === 'true') {
    return element as HTMLElement;
  }
  const nested = element.querySelector('[contenteditable="true"]');
  if (nested instanceof HTMLElement) {
    return nested;
  }
  return null;
}
