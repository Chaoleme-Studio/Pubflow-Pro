<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import MarkdownRender from 'markstream-vue';
import 'markstream-vue/index.css';
import type { ContentDraft } from '../../../src/types';

const props = defineProps<{
  draft: ContentDraft;
  videoUrl?: string;
  coverUrl?: string;
  imageUrls?: string[];
  musicPlaying?: boolean;
  mode: 'video' | 'image' | 'article';
  /** 文章 Markdown 内容（用于文章模式预览） */
  articleContent?: string;
}>();

const playing = ref(false);
const videoRef = ref<HTMLVideoElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const imageIndex = ref(0);
const dragStartX = ref<number | null>(null);
const dragDeltaX = ref(0);
const isDragging = ref(false);
const videoOrientation = ref<'portrait' | 'landscape' | 'unknown'>('unknown');
const imageOrientation = ref<'portrait' | 'landscape' | 'unknown'>('unknown');

const previewImages = computed(() => {
  if (props.imageUrls?.length) return props.imageUrls;
  return props.coverUrl ? [props.coverUrl] : [];
});

watch(
  () => previewImages.value.length,
  (length) => {
    if (!length) {
      imageIndex.value = 0;
      imageOrientation.value = 'unknown';
      return;
    }
    imageIndex.value = Math.min(imageIndex.value, length - 1);
  },
);

function togglePlay() {
  if (!videoRef.value) return;
  if (playing.value) {
    videoRef.value.pause();
  } else {
    videoRef.value.play();
  }
  playing.value = !playing.value;
}

function updateVideoOrientation() {
  const video = videoRef.value;
  if (!video?.videoWidth || !video.videoHeight) {
    videoOrientation.value = 'unknown';
    return;
  }
  videoOrientation.value = video.videoWidth > video.videoHeight ? 'landscape' : 'portrait';
}

function updateImageOrientation() {
  const img = imageRef.value;
  if (!img?.naturalWidth || !img?.naturalHeight) {
    imageOrientation.value = 'unknown';
    return;
  }
  imageOrientation.value = img.naturalWidth > img.naturalHeight ? 'landscape' : 'portrait';
}

const topicTags = computed(() => {
  return props.draft.topicsText
    .split(/[\s,，、\n]+/)
    .map(t => t.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, 5);
});

function prevImage() {
  if (previewImages.value.length <= 1) return;
  imageIndex.value = (imageIndex.value - 1 + previewImages.value.length) % previewImages.value.length;
}

function nextImage() {
  if (previewImages.value.length <= 1) return;
  imageIndex.value = (imageIndex.value + 1) % previewImages.value.length;
}

function startImageDrag(clientX: number) {
  dragStartX.value = clientX;
  isDragging.value = true;
  dragDeltaX.value = 0;
}

function moveImageDrag(clientX: number) {
  if (dragStartX.value === null) return;
  dragDeltaX.value = clientX - dragStartX.value;
}

function endImageDrag(clientX: number) {
  if (dragStartX.value === null) return;
  const delta = clientX - dragStartX.value;
  dragStartX.value = null;
  isDragging.value = false;
  dragDeltaX.value = 0;
  if (Math.abs(delta) < 30) return;
  if (delta < 0) nextImage();
  else prevImage();
}

</script>

<template>
  <div class="flex flex-col items-center">
    <div class="relative">
      <div class="absolute -left-1 top-24 h-12 w-1 rounded-l bg-slate-500/80"></div>
      <div class="absolute -right-1 top-32 h-16 w-1 rounded-r bg-slate-500/80"></div>
      <div class="absolute -right-1 top-52 h-16 w-1 rounded-r bg-slate-500/80"></div>

      <div class="relative w-[286px] rounded-[46px] bg-gradient-to-br from-slate-700 via-slate-950 to-slate-600 p-[4px] shadow-[0_28px_70px_rgba(15,23,42,0.34),inset_0_1px_0_rgba(255,255,255,0.28)]">
        <div class="rounded-[42px] bg-black p-[6px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div class="pointer-events-none absolute left-1/2 top-[13px] z-30 h-[30px] w-[94px] -translate-x-1/2 rounded-full bg-black shadow-[0_1px_1px_rgba(255,255,255,0.14),inset_0_0_0_1px_rgba(255,255,255,0.05)]">
            <div class="absolute right-5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-slate-800"></div>
          </div>

          <div class="relative h-[500px] w-full overflow-hidden rounded-[34px] bg-slate-900">
        <!-- 文章模式 -->
        <template v-if="mode === 'article'">
          <div class="absolute inset-0 flex flex-col bg-white">
            <!-- 文章头部 -->
            <div class="px-4 pt-6 pb-3">
              <div class="text-base font-bold leading-snug text-slate-900">
                {{ draft.title || '文章标题' }}
              </div>
              <div v-if="draft.description" class="mt-1.5 text-xs leading-relaxed text-slate-500">
                {{ draft.description }}
              </div>
              <div class="mt-2 flex items-center gap-2">
                <div class="h-6 w-6 rounded-full bg-gradient-to-br from-rose-400 to-orange-400"></div>
                <span class="text-[11px] font-bold text-slate-700">创作者名称</span>
              </div>
            </div>
            <div class="h-px bg-slate-100"></div>
            <!-- 文章正文预览 -->
            <div class="phone-article-preview flex-1 overflow-y-auto px-4 py-3">
              <div v-if="articleContent" class="text-xs leading-relaxed text-slate-700">
                <MarkdownRender
                  :content="articleContent"
                  custom-id="phone-preview"
                  :typewriter="false"
                  :max-live-nodes="200"
                  :batch-rendering="true"
                />
              </div>
              <div v-else class="space-y-2 text-xs leading-relaxed text-slate-400">
                <p>暂无文章内容</p>
                <p>在左侧编辑器中输入 Markdown 即可预览</p>
              </div>
            </div>
            <!-- 底部话题 -->
            <div v-if="topicTags.length" class="border-t border-slate-100 px-4 py-2">
              <div class="flex flex-wrap gap-1.5">
                <span v-for="tag in topicTags" :key="tag" class="text-[10px] font-medium text-rose-500">
                  #{{ tag }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- 视频模式 -->
        <template v-else-if="mode === 'video'">
          <video
            v-if="videoUrl"
            ref="videoRef"
            :src="videoUrl"
            class="absolute inset-0 h-full w-full"
            :class="videoOrientation === 'landscape' ? 'object-contain' : 'object-cover'"
            loop
            preload="metadata"
            @click="togglePlay"
            @loadedmetadata="updateVideoOrientation"
          />
          <!-- 封面/占位 -->
          <div v-else-if="coverUrl" class="absolute inset-0">
            <img :src="coverUrl" class="h-full w-full object-cover" />
          </div>
          <div v-else class="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-950">
            <svg class="h-16 w-16 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
          </div>

          <!-- 播放/暂停按钮 -->
          <div
            v-if="videoUrl"
            class="absolute inset-0 z-10 flex cursor-pointer items-center justify-center"
            @click="togglePlay"
          >
            <transition name="fade">
              <div v-if="!playing" class="grid h-14 w-14 place-items-center rounded-full bg-black/40 backdrop-blur-sm">
                <svg class="ml-1 h-7 w-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              </div>
            </transition>
          </div>
        </template>

        <!-- 图文模式 -->
        <template v-else>
          <div
            v-if="previewImages.length"
            class="absolute inset-0 cursor-grab active:cursor-grabbing select-none"
            @mousedown.prevent="startImageDrag($event.clientX)"
            @mousemove="moveImageDrag($event.clientX)"
            @mouseup="endImageDrag($event.clientX)"
            @mouseleave="dragStartX = null; isDragging = false; dragDeltaX = 0"
            @touchstart.passive="startImageDrag($event.touches[0].clientX)"
            @touchmove.passive="moveImageDrag($event.touches[0].clientX)"
            @touchend="endImageDrag($event.changedTouches[0].clientX)"
          >
            <img
              ref="imageRef"
              :src="previewImages[imageIndex]"
              class="h-full w-full transition-transform duration-200"
              :class="imageOrientation === 'landscape' ? 'object-contain' : 'object-cover'"
              :style="isDragging ? { transform: `translateX(${dragDeltaX}px)` } : {}"
              draggable="false"
              @load="updateImageOrientation"
            />
            <div v-if="previewImages.length > 1" class="absolute inset-x-4 bottom-2 z-30 flex gap-1">
              <span
                v-for="(_, index) in previewImages"
                :key="index"
                class="h-0.5 flex-1 rounded-full transition-colors"
                :class="index === imageIndex ? 'bg-white' : 'bg-white/35'"
              ></span>
            </div>
          </div>
          <div v-else class="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-950">
            <svg class="h-16 w-16 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
        </template>

        <!-- 底部渐变遮罩 -->
        <div class="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>

        <!-- 底部信息叠加层 -->
        <div class="absolute inset-x-0 bottom-0 z-10 px-4 pb-6">
          <div v-if="mode === 'image' && draft.musicFileName" class="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-white/80">
            <span class="grid h-5 w-5 place-items-center rounded-full bg-white/15">
              <svg v-if="musicPlaying" class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 10v4h3l4 4V6L7 10H4zm10.5 2A3.5 3.5 0 0 0 13 9.1v5.8a3.5 3.5 0 0 0 1.5-2.9z"/>
              </svg>
              <svg v-else class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </span>
            <span class="truncate">{{ draft.musicFileName }}</span>
          </div>

          <!-- 标题 -->
          <div class="mb-1.5 text-[15px] font-bold leading-tight text-white drop-shadow">
            {{ draft.title || '视频标题' }}
          </div>

          <!-- 描述（2行截断） -->
          <div v-if="draft.description" class="mb-2 line-clamp-2 text-xs leading-relaxed text-white/80">
            {{ draft.description }}
          </div>

          <!-- 话题标签 -->
          <div v-if="topicTags.length" class="mb-3 flex flex-wrap gap-1.5">
            <span v-for="tag in topicTags" :key="tag" class="text-[11px] font-medium text-white/90">
              #{{ tag }}
            </span>
          </div>

          <!-- 用户信息条 -->
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-full bg-gradient-to-br from-rose-400 to-orange-400 ring-2 ring-white/30"></div>
            <span class="text-xs font-bold text-white drop-shadow">创作者名称</span>
            <button class="ml-1 rounded border border-white/40 px-2 py-0.5 text-[10px] font-bold text-white/80">
              关注
            </button>
          </div>
        </div>

        <!-- 右侧互动按钮 -->
        <div class="absolute right-3 bottom-24 z-10 flex flex-col items-center gap-5">
          <div class="flex flex-col items-center gap-1">
            <div class="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-sm">
              <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>
            <span class="text-[10px] font-bold text-white">0</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-sm">
              <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </div>
            <span class="text-[10px] font-bold text-white">0</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-sm">
              <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </div>
            <span class="text-[10px] font-bold text-white">分享</span>
          </div>
        </div>

        <!-- 顶部平台标识 -->
            <div class="absolute left-4 top-8 z-10 text-xs font-bold text-white/60">某音</div>
            <div class="absolute bottom-2 left-1/2 z-20 h-1 w-28 -translate-x-1/2 rounded-full bg-white/78"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-3 text-center text-xs text-slate-400">预览效果 · 以某音为例</div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.phone-article-preview :deep(h1) {
  font-size: 0.8rem;
  font-weight: 700;
  margin-bottom: 0.4rem;
  color: #0f172a;
}
.phone-article-preview :deep(h2) {
  font-size: 0.7rem;
  font-weight: 700;
  margin-top: 0.75rem;
  margin-bottom: 0.3rem;
  color: #0f172a;
}
.phone-article-preview :deep(h3) {
  font-size: 0.65rem;
  font-weight: 600;
  margin-top: 0.5rem;
  margin-bottom: 0.25rem;
  color: #1e293b;
}
.phone-article-preview :deep(p) {
  margin-bottom: 0.4rem;
  line-height: 1.6;
  color: #334155;
}
.phone-article-preview :deep(code) {
  background: #f1f5f9;
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-size: 0.7em;
  color: #be185d;
}
.phone-article-preview :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 0.5rem;
  border-radius: 4px;
  overflow-x: auto;
  margin-bottom: 0.5rem;
  font-size: 0.6em;
  line-height: 1.5;
}
.phone-article-preview :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}
.phone-article-preview :deep(blockquote) {
  border-left: 2px solid #f43f5e;
  padding-left: 0.5rem;
  margin: 0.5rem 0;
  color: #64748b;
  font-style: italic;
  font-size: 0.7em;
}
.phone-article-preview :deep(ul),
.phone-article-preview :deep(ol) {
  padding-left: 1rem;
  margin-bottom: 0.4rem;
}
.phone-article-preview :deep(li) {
  margin-bottom: 0.15rem;
  line-height: 1.5;
  color: #334155;
}
.phone-article-preview :deep(strong) {
  font-weight: 700;
  color: #0f172a;
}
.phone-article-preview :deep(hr) {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 0.75rem 0;
}
.phone-article-preview :deep(img) {
  max-width: 100%;
  border-radius: 4px;
  margin: 0.3rem 0;
}
</style>
