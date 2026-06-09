<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import MarkdownRender from 'markstream-vue';
import 'markstream-vue/index.css';
import type { ContentDraft } from '../../../src/types';
import { useArticleAI } from '../../../src/features/ai/useArticleAI';
import AiDiffView from './AiDiffView.vue';

const props = defineProps<{
  draft: ContentDraft;
  /** 保存图片文件到项目 assets/images/，返回相对路径如 "assets/images/img-1.png" */
  saveImageFile?: (file: File, fileName: string) => Promise<string>;
  /** 读取项目中的图片文件，返回可用于 <img src> 的 URL */
  loadImageUrl?: (relativePath: string) => Promise<string>;
}>();

const emit = defineEmits<{
  'update:draft': [draft: Partial<ContentDraft>];
  /** 持久化用的 Markdown（图片用文件路径），用于保存到 project.json */
  'update:persistContent': [content: string];
}>();

// 从 articleContent 中恢复图片定义到 imageStore，markdownText 只保留正文部分
// 图片引用格式：[img-N]: assets/images/img-N.ext（文件路径，不是 base64）
function parseArticleContent(raw: string): { body: string; images: Map<string, string>; nextId: number } {
  const images = new Map<string, string>();
  let maxId = 0;
  const lines = raw.split('\n');
  const bodyLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\[img-(\d+)\]:\s*(.+)$/);
    if (m && !m[2].startsWith('data:')) {
      images.set(m[1], m[2].trim());
      maxId = Math.max(maxId, Number(m[1]));
    } else {
      bodyLines.push(line);
    }
  }
  let body = bodyLines.join('\n').replace(/\n{3,}$/, '\n\n');
  return { body, images, nextId: maxId };
}

const parsed = parseArticleContent(props.draft.articleContent || '');
const markdownText = ref(parsed.body);
const editorRef = ref<HTMLTextAreaElement | null>(null);
const previewRef = ref<HTMLElement | null>(null);
const scrollSync = ref(true);

// 图片存储：短ID → 文件路径（如 "assets/images/img-1.png"）
const imageStore = ref<Map<string, string>>(parsed.images);
// 图片预览 URL 缓存：文件路径 → object URL
const previewUrls = ref<Map<string, string>>(new Map());
let imageCounter = parsed.nextId;

// AI 润色 / 排版
const {
  aiMode,
  aiStreaming,
  aiResult,
  aiError,
  startAI,
  cancelAI,
  applyResult,
  closeDiff,
} = useArticleAI({
  markdownText,
  onApply(newText: string) {
    markdownText.value = newText;
    emit('update:draft', { articleContent: fullMarkdown.value });
  },
});

const aiModeLabel = computed(() => aiMode.value === 'polish' ? '润色' : '排版');
const aiDiffRef = ref<HTMLElement | null>(null);

// 点击 AI 按钮后自动滚动到 diff 视图
watch(aiMode, (mode) => {
  if (mode) {
    nextTick(() => {
      aiDiffRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
});

// 加载已有图片的预览 URL
async function loadPreviewUrls() {
  if (!props.loadImageUrl) return;
  for (const [id, filePath] of imageStore.value) {
    if (!previewUrls.value.has(filePath)) {
      try {
        const url = await props.loadImageUrl(filePath);
        previewUrls.value.set(filePath, url);
      } catch { /* ignore */ }
    }
  }
}

onMounted(() => { void loadPreviewUrls(); });

// 清理 object URLs
onUnmounted(() => {
  for (const url of previewUrls.value.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
});

const defaultContent = `# 文章标题

在这里撰写你的文章内容...

## 小节标题

正文段落，支持 **加粗**、*斜体*、\`行内代码\` 等 Markdown 语法。

直接粘贴图片到编辑器中即可插入。
`;

onMounted(() => {
  if (!markdownText.value) {
    markdownText.value = defaultContent;
  }
});

// 当外部修改 draft.articleContent 时（如从视频库恢复），同步到编辑器
watch(() => props.draft.articleContent, (val) => {
  if (val && val !== fullMarkdown.value) {
    const parsed = parseArticleContent(val);
    markdownText.value = parsed.body;
    imageStore.value = parsed.images;
    imageCounter = parsed.nextId;
  }
});

// 定期检查 draft.articleContent 是否为空（hydrate 竞态可能导致被覆盖），自动补上默认内容
watch(() => props.draft.articleContent, (val) => {
  if (!val && markdownText.value && markdownText.value !== defaultContent) {
    // 编辑器有内容但 draft.articleContent 为空，重新同步
    emit('update:draft', { articleContent: fullMarkdown.value });
  }
});

const wordCount = computed(() => {
  const text = markdownText.value.replace(/[#*\-\[\]()>\-|`]/g, '').trim();
  return text.length;
});

// 将 textarea 中的图片引用 [img-xxx] 替换为实际 URL 用于预览
const resolvedMarkdown = computed(() => {
  let result = markdownText.value;
  for (const [id, filePath] of imageStore.value) {
    const url = previewUrls.value.get(filePath) || filePath;
    result = result.replaceAll(`[img-${id}]`, `(${url})`);
  }
  return result;
});

// 带图片定义的完整 Markdown（用于保存到 draft / 发送到平台）
// 图片用 data URL，确保 content script 可直接使用
const fullMarkdown = computed(() => {
  if (imageStore.value.size === 0) return markdownText.value;
  const definitions = Array.from(imageStore.value.entries())
    .map(([id, filePath]) => {
      const url = previewUrls.value.get(filePath) || filePath;
      return `[img-${id}]: ${url}`;
    })
    .join('\n');
  return markdownText.value + '\n\n' + definitions;
});

// 带图片文件路径的 Markdown（用于持久化到 project.json，不包含 base64）
const persistMarkdown = computed(() => {
  if (imageStore.value.size === 0) return markdownText.value;
  const definitions = Array.from(imageStore.value.entries())
    .map(([id, filePath]) => `[img-${id}]: ${filePath}`)
    .join('\n');
  return markdownText.value + '\n\n' + definitions;
});

// 持久化 Markdown（文件路径版本）变化时通知父组件
watch(persistMarkdown, (val) => {
  emit('update:persistContent', val);
}, { immediate: true });

function onEditorScroll(e: Event) {
  if (!scrollSync.value) return;
  const el = e.target as HTMLTextAreaElement;
  if (!previewRef.value) return;
  const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight || 1);
  previewRef.value.scrollTop = ratio * (previewRef.value.scrollHeight - previewRef.value.clientHeight);
}

function insertAtCursor(text: string) {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  markdownText.value = markdownText.value.slice(0, start) + text + markdownText.value.slice(end);
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  });
}

function onInput() {
  emit('update:draft', { articleContent: fullMarkdown.value });
}

async function insertImage(file: File) {
  const id = String(++imageCounter);
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.png';
  const fileName = `img-${id}${ext}`;

  if (props.saveImageFile) {
    // 保存到项目 assets/images/，返回文件路径
    const filePath = await props.saveImageFile(file, fileName);
    imageStore.value.set(id, filePath);
    // 生成预览 URL
    if (props.loadImageUrl) {
      const url = await props.loadImageUrl(filePath);
      previewUrls.value.set(filePath, url);
    }
  } else {
    // fallback：没有 saveImageFile 时用 base64（仅用于预览，不持久化）
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    imageStore.value.set(id, base64);
  }

  insertAtCursor(`![图片][img-${id}]`);
  emit('update:draft', { articleContent: fullMarkdown.value });
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      insertImage(file);
      return;
    }
  }
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (!files) return;
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      insertImage(file);
    }
  }
}
</script>

<template>
  <div class="flex flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-1 border-b border-slate-200 px-4 py-2">
      <button class="rounded px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="标题" @click="insertAtCursor('# ')">H1</button>
      <button class="rounded px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="二级标题" @click="insertAtCursor('## ')">H2</button>
      <button class="rounded px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="三级标题" @click="insertAtCursor('### ')">H3</button>
      <span class="mx-1 h-4 w-px bg-slate-200"></span>
      <button class="rounded px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="加粗" @click="insertAtCursor('**粗体**')">B</button>
      <button class="rounded px-2 py-1 text-xs italic text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="斜体" @click="insertAtCursor('*斜体*')">I</button>
      <button class="rounded px-2 py-1 text-xs font-mono text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="代码" @click="insertAtCursor('`code`')">&lt;/&gt;</button>
      <span class="mx-1 h-4 w-px bg-slate-200"></span>
      <button class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="链接" @click="insertAtCursor('[文本](url)')">🔗</button>
      <button class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="图片" @click="insertAtCursor('![描述](url)')">🖼</button>
      <button class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="引用" @click="insertAtCursor('> ')">❝</button>
      <button class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button" title="列表" @click="insertAtCursor('- ')">☰</button>
      <span class="mx-1 h-4 w-px bg-slate-200"></span>
      <button
        class="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
        type="button"
        title="AI 润色文章"
        :disabled="aiStreaming"
        @click="startAI('polish')"
      >AI润色</button>
      <button
        class="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
        type="button"
        title="AI 优化排版"
        :disabled="aiStreaming"
        @click="startAI('format')"
      >AI排版</button>
      <div class="ml-auto flex items-center gap-3 text-xs text-slate-400">
        <span>{{ wordCount }} 字</span>
        <label class="flex cursor-pointer items-center gap-1.5">
          <input v-model="scrollSync" type="checkbox" class="h-3 w-3" />
          同步滚动
        </label>
      </div>
    </div>

    <!-- 两列编辑器：左 Markdown 输入 / 右 markstream-vue 渲染 -->
    <div class="grid min-h-[500px] grid-cols-2 divide-x divide-slate-200">
      <textarea
        ref="editorRef"
        v-model="markdownText"
        class="resize-none border-none bg-white p-5 font-mono text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-300"
        placeholder="在这里输入 Markdown 内容，支持直接粘贴图片..."
        spellcheck="false"
        @scroll="onEditorScroll"
        @input="onInput"
        @paste="onPaste"
        @drop.prevent="onDrop"
      />

      <div ref="previewRef" class="preview-pane overflow-y-auto bg-[#fafbfc] p-5">
        <MarkdownRender
          :content="resolvedMarkdown"
          custom-id="pubflow-article"
          :typewriter="false"
          :max-live-nodes="500"
          :batch-rendering="true"
        />
      </div>
    </div>

    <!-- AI 润色/排版 diff 视图 -->
    <div ref="aiDiffRef">
    <AiDiffView
      v-if="aiMode"
      :original="markdownText"
      :ai-result="aiResult"
      :streaming="aiStreaming"
      :mode-label="aiModeLabel"
      :error="aiError"
      @apply="applyResult"
      @cancel="closeDiff"
    />
    </div>
  </div>
</template>

<style>
.preview-pane {
  --preview-heading: #0f172a;
  --preview-text: #334155;
  --preview-border: #e2e8f0;
  --preview-muted: #64748b;
  --preview-accent: #f43f5e;
  --preview-link: #2563eb;
  --preview-code: #be185d;
}
.preview-pane h1 {
  font-size: 1.5rem;
  font-weight: 800;
  margin-bottom: 0.75rem;
  color: var(--preview-heading);
  border-bottom: 1px solid var(--preview-border);
  padding-bottom: 0.5rem;
}
.preview-pane h2 {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  color: var(--preview-heading);
}
.preview-pane h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.4rem;
  color: #1e293b;
}
.preview-pane p {
  margin-bottom: 0.75rem;
  line-height: 1.8;
  color: var(--preview-text);
}
.preview-pane code {
  background: #f1f5f9;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.875em;
  color: var(--preview-code);
}
.preview-pane pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 1rem;
  font-size: 0.85em;
  line-height: 1.6;
}
.preview-pane pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}
.preview-pane blockquote {
  border-left: 4px solid var(--preview-accent);
  padding-left: 1rem;
  margin: 1rem 0;
  color: var(--preview-muted);
  font-style: italic;
}
.preview-pane ul,
.preview-pane ol {
  padding-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.preview-pane li {
  margin-bottom: 0.3rem;
  line-height: 1.7;
  color: var(--preview-text);
}
.preview-pane a {
  color: var(--preview-link);
  text-decoration: underline;
}
.preview-pane hr {
  border: none;
  border-top: 1px solid var(--preview-border);
  margin: 1.5rem 0;
}
.preview-pane strong {
  font-weight: 700;
  color: var(--preview-heading);
}
.preview-pane table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}
.preview-pane th,
.preview-pane td {
  border: 1px solid var(--preview-border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.9em;
}
.preview-pane th {
  background: #f8fafc;
  font-weight: 700;
}
.preview-pane img {
  max-width: 100%;
  border-radius: 8px;
  margin: 0.5rem 0;
}
</style>
