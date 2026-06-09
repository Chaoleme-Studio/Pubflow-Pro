export function injectXiaohongshuImageDescription(description: string) {
  const editor = Array.from(document.querySelectorAll<HTMLElement>('.tiptap.ProseMirror, [contenteditable="true"]'))
    .find((candidate) => isVisible(candidate));
  if (!editor) {
    return { ok: false, error: '页面主世界未找到小红书图文描述编辑器' };
  }

  editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  editor.focus();

  const tiptapEditor = findTiptapEditor(editor);
  if (tiptapEditor) {
    try {
      tiptapEditor.commands.setContent(plainTextToHtml(description));
      tiptapEditor.commands.focus?.();
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      if (editor.textContent?.includes(description)) {
        return { ok: true };
      }
    } catch {
      // 回退到模拟输入。
    }
  }

  const activeDocument = editor.ownerDocument || document;
  activeDocument.execCommand('selectAll', false);
  activeDocument.execCommand('delete', false);
  const inserted = activeDocument.execCommand('insertText', false, description);
  if (!inserted || !editor.textContent?.includes(description)) {
    editor.textContent = description;
  }

  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: description }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  return editor.textContent?.includes(description)
    ? { ok: true }
    : { ok: false, error: '小红书图文描述填充后未同步到编辑器' };
}

function findTiptapEditor(element: HTMLElement): any {
  const candidates = [element, ...Array.from(element.querySelectorAll<HTMLElement>('.ProseMirror, .tiptap'))];
  for (const candidate of candidates) {
    const editor = (candidate as any).editor;
    if (editor?.commands?.setContent) return editor;
  }
  return null;
}

function plainTextToHtml(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    Number(style.opacity || '1') > 0
  );
}
