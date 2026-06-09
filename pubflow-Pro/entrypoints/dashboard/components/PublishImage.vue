<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { ContentDraft } from '../../../src/types';

const props = defineProps<{
  draft: ContentDraft;
  imageFiles: File[];
  imagePreviewUrls: string[];
}>();

const emit = defineEmits<{
  'update:cover': [file: File | null];
  'update:coverUrl': [url: string];
  'update:imageUrls': [urls: string[]];
  'update:imageFiles': [files: File[]];
  'update:draft': [draft: Partial<ContentDraft>];
}>();

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
}

const images = ref<ImageItem[]>([]);
const maxImages = 35;
let syncingFromProps = false;

function revokeInternalImageUrls() {
  for (const image of images.value) {
    if (image.url.startsWith('blob:') && !props.imagePreviewUrls.includes(image.url)) {
      URL.revokeObjectURL(image.url);
    }
  }
}

function syncImagesFromProps() {
  syncingFromProps = true;
  revokeInternalImageUrls();
  images.value = props.imageFiles.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
    url: props.imagePreviewUrls[index] || URL.createObjectURL(file),
    name: file.name,
  }));
  syncingFromProps = false;
}

watch(
  () => [props.imageFiles, props.imagePreviewUrls] as const,
  syncImagesFromProps,
  { immediate: true, deep: true },
);

onBeforeUnmount(() => {
  revokeInternalImageUrls();
});

function onImagesSelect(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  addImages(files);
}

function addImages(files: File[]) {
  const remaining = maxImages - images.value.length;
  const toAdd = files.filter(f => f.type.startsWith('image/')).slice(0, remaining);
  for (const file of toAdd) {
    images.value.push({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
    });
  }
  // 第一张自动设为封面
  if (images.value.length > 0) {
    emit('update:cover', images.value[0].file);
    emit('update:coverUrl', images.value[0].url);
  }
  emitImageUrls();
  emitImageFiles();
}

function removeImage(id: string) {
  const idx = images.value.findIndex(img => img.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(images.value[idx].url);
  images.value.splice(idx, 1);
  if (images.value.length > 0) {
    emit('update:cover', images.value[0].file);
    emit('update:coverUrl', images.value[0].url);
  } else {
    emit('update:cover', null);
    emit('update:coverUrl', '');
  }
  emitImageUrls();
  emitImageFiles();
}

function emitImageUrls() {
  emit('update:imageUrls', images.value.map((image) => image.url));
}

function emitImageFiles() {
  if (syncingFromProps) return;
  emit('update:imageFiles', images.value.map((image) => image.file));
}

function dragOver(e: DragEvent) {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.add('border-rose-400');
}

function dragLeave(e: DragEvent) {
  (e.currentTarget as HTMLElement).classList.remove('border-rose-400');
}

function drop(e: DragEvent) {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.remove('border-rose-400');
  const files = Array.from(e.dataTransfer?.files || []);
  addImages(files);
}
</script>

<template>
  <div class="p-5">
    <!-- 已上传图片网格 -->
    <div v-if="images.length > 0" class="mb-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-bold text-slate-500">已选 {{ images.length }}/{{ maxImages }} 张</span>
        <label class="cursor-pointer text-xs font-bold text-rose-500 hover:text-rose-600">
          + 继续添加
          <input class="hidden" type="file" accept="image/*" multiple @change="onImagesSelect" />
        </label>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="img in images" :key="img.id" class="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          <img :src="img.url" :alt="img.name" class="h-full w-full object-cover" />
          <button
            class="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500"
            type="button"
            @click="removeImage(img.id)"
          >×</button>
          <div v-if="img === images[0]" class="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
            封面
          </div>
        </div>
        <!-- 添加更多占位 -->
        <label
          v-if="images.length < maxImages"
          class="grid aspect-square cursor-pointer place-items-center rounded-md border-2 border-dashed border-slate-200 text-slate-300 transition hover:border-rose-300 hover:text-rose-400"
        >
          <input class="hidden" type="file" accept="image/*" multiple @change="onImagesSelect" />
          <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg>
        </label>
      </div>
    </div>

    <!-- 空状态：拖拽上传区 -->
    <label
      v-else
      class="grid min-h-[260px] cursor-pointer place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-[#f7f8fa] text-center transition hover:border-rose-400 hover:bg-rose-50/20"
      @dragover="dragOver"
      @dragleave="dragLeave"
      @drop="drop"
    >
      <input class="hidden" type="file" accept="image/*" multiple @change="onImagesSelect" />
      <div>
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-100 to-pink-100 text-3xl text-violet-500 shadow-sm">
          <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <div class="mt-5 text-lg font-black text-slate-950">上传图片素材</div>
        <div class="mt-2 text-sm text-slate-500">支持 jpg / png / webp，最多 {{ maxImages }} 张，第一张自动作为封面</div>
        <div class="mx-auto mt-6 w-48 rounded-lg bg-gradient-to-r from-violet-500 to-pink-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:from-violet-600 hover:to-pink-600">
          选择图片
        </div>
      </div>
    </label>
  </div>
</template>
