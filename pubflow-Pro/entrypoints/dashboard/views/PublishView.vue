<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { supportsContentType, type CampaignRecommendation, type PlatformConfig } from '../../../src/platforms';
import type { ContentDraft, DistributionTask, PlatformId, Visibility } from '../../../src/types';
import PhonePreview from '../components/PhonePreview.vue';
import PublishArticle from '../components/PublishArticle.vue';
import PublishImage from '../components/PublishImage.vue';
import PublishVideo from '../components/PublishVideo.vue';

const activePlatformTab = ref<PlatformId | ''>('');

const props = defineProps<{
  draft: ContentDraft;
  uploadTab: 'video' | 'image' | 'article';
  platforms: PlatformConfig[];
  topicCount: number;
  videoPreviewUrl: string;
  videoFile: File | null;
  coverPreviewUrl: string;
  imageFiles: File[];
  imagePreviewUrls: string[];
  musicPreviewUrl: string;
  previewMusicPlaying: boolean;
  activeTasks: Array<{
    id: string;
    title: string;
    detail: string;
    status: string;
  }>;
  statusText: (status: string) => string;
  campaignRecommendations: CampaignRecommendation[];
  selectedCampaignIds: string[];
  selectedCampaigns: Array<{
    标识: string;
    简称: string;
    平台标识: PlatformId;
    官方链接: string;
  }>;
  campaignTypeText: (type: string) => string;
  saveImageFile?: (file: File, fileName: string) => Promise<string>;
  loadImageUrl?: (relativePath: string) => Promise<string>;
}>();

const emit = defineEmits<{
  'update:uploadTab': [value: 'video' | 'image' | 'article'];
  'update:video': [file: File | null];
  'update:cover': [file: File | null];
  'update:coverUrl': [url: string];
  'update:imageUrls': [urls: string[]];
  'update:imageFiles': [files: File[]];
  'update:draft': [draft: Partial<ContentDraft>];
  'update:persistContent': [content: string];
  persistDraft: [];
  setCoverFile: [event: Event];
  setMusicFile: [event: Event];
  togglePreviewMusic: [];
  togglePlatform: [platformId: PlatformId];
  toggleCampaign: [campaignId: string];
  openCampaign: [url: string];
}>();

const visibilityOptions: Array<{ value: Visibility; label: string; icon: string }> = [
  { value: 'public', label: '公开', icon: '🌍' },
  { value: 'friends', label: '好友可见', icon: '👥' },
  { value: 'private', label: '仅自己', icon: '🔒' },
];

const selectablePlatforms = computed(() =>
  props.platforms.filter((platform) => supportsContentType(platform, props.uploadTab)),
);

const allPlatformsSelected = computed(() =>
  selectablePlatforms.value.length > 0 &&
  selectablePlatforms.value.every((p) => props.draft.selectedPlatforms.includes(p.id)),
);

const selectedPersonalPlatforms = computed(() =>
  props.platforms.filter((platform) =>
    props.draft.selectedPlatforms.includes(platform.id) &&
    supportsContentType(platform, props.uploadTab),
  ),
);

const selectedPersonalPlatformIds = computed(() => new Set(selectedPersonalPlatforms.value.map((platform) => platform.id)));

const hasZhihuPersonalSettings = computed(
  () => props.draft.selectedPlatforms.includes('zhihu') || Boolean(props.draft.platformSettings?.zhihu),
);

watch(
  [selectedPersonalPlatforms, hasZhihuPersonalSettings],
  (platforms) => {
    const visiblePlatforms = platforms[0];
    const zhihuVisible = platforms[1];
    if (!visiblePlatforms.length && !zhihuVisible) {
      activePlatformTab.value = '';
      return;
    }
    const activeVisible =
      (activePlatformTab.value === 'zhihu' && zhihuVisible) ||
      visiblePlatforms.some((platform) => platform.id === activePlatformTab.value);
    if (!activePlatformTab.value || !activeVisible) {
      activePlatformTab.value = visiblePlatforms[0]?.id || 'zhihu';
    }
  },
  { immediate: true },
);

function toggleAllPlatforms() {
  const ids = selectablePlatforms.value.map((p) => p.id);
  const allSelected = ids.every((id) => props.draft.selectedPlatforms.includes(id));
  for (const id of ids) {
    if (allSelected) {
      if (props.draft.selectedPlatforms.includes(id)) emit('togglePlatform', id);
    } else {
      if (!props.draft.selectedPlatforms.includes(id)) emit('togglePlatform', id);
    }
  }
}

function isPlatformSelectable(platform: PlatformConfig) {
  return supportsContentType(platform, props.uploadTab);
}

function toLocalDatetimeString(timestamp: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function onScheduledChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.type === 'checkbox') {
    if (input.checked) {
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 24);
      emit('update:draft', { scheduledAt: tomorrow.getTime() });
    } else {
      emit('update:draft', { scheduledAt: 0 });
    }
  } else {
    const timestamp = input.value ? new Date(input.value).getTime() : 0;
    emit('update:draft', { scheduledAt: timestamp });
  }
}

function onVisibilityChange(value: Visibility) {
  emit('update:draft', { visibility: value });
}

function onOriginalDeclareChange(event: Event) {
  emit('update:draft', { originalDeclare: (event.target as HTMLInputElement).checked });
}

// 去掉图片定义行，只保留正文用于手机预览
const previewArticleContent = computed(() => {
  const raw = props.draft.articleContent || '';
  return raw.replace(/^\[img-\d+\]:\s*.+$/gm, '').replace(/\n{3,}$/, '\n\n').trim();
});

function onPlatformSettingChange(platformId: PlatformId, key: string, value: unknown) {
  emit('update:draft', {
    platformSettings: {
      ...(props.draft.platformSettings || {}),
      [platformId]: {
        ...(props.draft.platformSettings?.[platformId] || {}),
        [key]: value,
      },
    },
  });
}
</script>

<template>
  <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
    <div class="grid content-start gap-4 self-start">
      <section class="pf-card overflow-hidden">
        <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div class="flex gap-6 text-sm font-black">
            <button
              v-for="tab in ([
                { key: 'video', label: '发布视频' },
                { key: 'image', label: '发布图文' },
                { key: 'article', label: '发布文章' },
              ] as const)"
              :key="tab.key"
              class="border-b-2 pb-3 transition"
              :class="uploadTab === tab.key ? 'border-rose-500 text-slate-950' : 'border-transparent text-slate-400 hover:text-slate-600'"
              type="button"
              @click="emit('update:uploadTab', tab.key)"
            >{{ tab.label }}</button>
          </div>
          <span v-if="uploadTab === 'video'" class="text-xs text-slate-400">mp4/webm · 60分钟内 · 推荐 9:16</span>
          <span v-else-if="uploadTab === 'image'" class="text-xs text-slate-400">jpg/png/webp · 最多 35 张</span>
          <span v-else class="text-xs text-slate-400">Markdown · 同步到图文平台</span>
        </div>

        <PublishVideo
          v-if="uploadTab === 'video'"
          :draft="draft"
          :video-url="videoPreviewUrl"
          :video-file="videoFile"
          @update:video="emit('update:video', $event)"
        />
        <PublishImage
          v-else-if="uploadTab === 'image'"
          :draft="draft"
          :cover-url="coverPreviewUrl"
          :image-files="imageFiles"
          :image-preview-urls="imagePreviewUrls"
          @update:cover="emit('update:cover', $event)"
          @update:cover-url="emit('update:coverUrl', $event)"
          @update:image-urls="emit('update:imageUrls', $event)"
          @update:image-files="emit('update:imageFiles', $event)"
          @update:draft="emit('update:draft', $event)"
        />
        <PublishArticle v-else :draft="draft" :save-image-file="saveImageFile" :load-image-url="loadImageUrl" @update:draft="emit('update:draft', $event)" @update:persist-content="emit('update:persistContent', $event)" />
      </section>

      <section class="pf-card-padded">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="pf-section-title">发布信息</h2>
          <div class="flex gap-2">
            <button class="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:border-blue-400" type="button">AI 填写</button>
          </div>
        </div>

        <!-- 文章模式：文章标题 + 文章摘要（仅抖音） -->
        <div v-if="uploadTab === 'article'" class="grid gap-3">
          <label class="grid gap-1.5">
            <span class="pf-label-sm">文章标题</span>
            <input v-model="draft.title" class="pf-input-accent" maxlength="30" placeholder="请输入文章标题，最多30字" @change="emit('persistDraft')" />
          </label>
          <label v-if="draft.selectedPlatforms.includes('douyin')" class="grid gap-1.5">
            <span class="pf-label-sm">文章摘要 <span class="text-[11px] text-slate-400">（仅抖音需要，最多30字）</span></span>
            <input v-model="draft.description" class="pf-input-accent" maxlength="30" placeholder="添加内容摘要吸引用户阅读" @change="emit('persistDraft')" />
          </label>
          <label class="grid gap-1.5">
            <div class="flex items-center justify-between">
              <span class="pf-label-sm">话题</span>
              <span class="text-[11px] text-slate-400">{{ topicCount }} 个</span>
            </div>
            <input v-model="draft.topicsText" class="pf-input-accent" placeholder="#话题1 #话题2" @change="emit('persistDraft')" />
          </label>
        </div>

        <!-- 视频/图文模式：标题 + 描述 + 话题 + 配乐 -->
        <div v-else class="grid gap-3">
          <label class="grid gap-1.5">
            <span class="pf-label-sm">标题</span>
            <input v-model="draft.title" class="pf-input-accent" maxlength="80" placeholder="请输入作品标题" @change="emit('persistDraft')" />
          </label>
          <label class="grid gap-1.5">
            <span class="pf-label-sm">作品描述</span>
            <textarea v-model="draft.description" class="pf-input-accent min-h-24 resize-y leading-5" placeholder="添加作品简介和亮点" @change="emit('persistDraft')" />
          </label>
          <label class="grid gap-1.5">
            <div class="flex items-center justify-between">
              <span class="pf-label-sm">话题</span>
              <span class="text-[11px] text-slate-400">{{ topicCount }} 个</span>
            </div>
            <input v-model="draft.topicsText" class="pf-input-accent" placeholder="#话题1 #话题2" @change="emit('persistDraft')" />
          </label>
          <div class="grid gap-1.5">
            <span class="pf-label-sm">配乐</span>
            <div class="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <button
                class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-300"
                type="button"
                :disabled="!musicPreviewUrl"
                @click="emit('togglePreviewMusic')"
              >
                <svg v-if="!previewMusicPlaying" class="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 5h4v14H6zm8 0h4v14h-4z"/>
                </svg>
              </button>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-bold text-slate-800">{{ draft.musicFileName || '未选择配乐' }}</div>
                <div class="text-[11px] text-slate-400">{{ draft.musicSize ? `${Math.max(1, Math.round(draft.musicSize / 1024))} KB` : '支持 mp3 / wav / m4a' }}</div>
              </div>
              <label class="shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-rose-300 hover:text-rose-600">
                选择配乐
                <input class="hidden" type="file" accept="audio/*" @change="emit('setMusicFile', $event)" />
              </label>
            </div>
          </div>
          <label class="grid gap-1.5">
            <span class="pf-label-sm">配乐名称 <span class="text-[11px] text-slate-400">（平台搜索用，可选）</span></span>
            <input v-model="draft.musicName" class="pf-input" placeholder="输入配乐名称，用于平台搜索" @change="emit('persistDraft')" />
          </label>
        </div>
      </section>

      <section class="pf-card-padded">
        <h2 class="pf-section-title mb-4">发布设置</h2>
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <span class="pf-label-sm">定时发布</span>
            <div class="flex items-center gap-3">
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  :checked="(draft.scheduledAt ?? 0) > 0"
                  @change="onScheduledChange($event)"
                />
                <div class="h-5 w-9 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-rose-500 peer-checked:after:translate-x-full"></div>
              </label>
              <input
                v-if="(draft.scheduledAt ?? 0) > 0"
                type="datetime-local"
                class="pf-input-accent flex-1"
                :value="toLocalDatetimeString(draft.scheduledAt ?? 0)"
                @change="onScheduledChange($event)"
              />
              <span v-else class="text-xs text-slate-400">立即发布</span>
            </div>
          </div>

          <div class="grid gap-1.5">
            <span class="pf-label-sm">谁可以看</span>
            <div class="flex gap-2">
              <button
                v-for="option in visibilityOptions"
                :key="option.value"
                class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold transition"
                :class="draft.visibility === option.value ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'"
                type="button"
                @click="onVisibilityChange(option.value)"
              >
                <span>{{ option.icon }}</span>
                {{ option.label }}
              </button>
            </div>
          </div>

          <label class="flex items-center gap-3">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
              :checked="draft.originalDeclare"
              @change="onOriginalDeclareChange($event)"
            />
            <span class="text-sm font-bold text-slate-700">声明原创</span>
            <span class="text-[11px] text-slate-400">勾选后各平台将标记为原创内容</span>
          </label>
        </div>
      </section>

      <section class="pf-card-padded">
        <h2 class="pf-section-title mb-4">平台个性化设置</h2>
        <div class="mb-3 flex flex-wrap gap-2">
          <button
            v-for="platform in selectedPersonalPlatforms"
            :key="platform.id"
            class="rounded-md border px-3 py-1.5 text-xs font-bold transition"
            :class="activePlatformTab === platform.id ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'"
            type="button"
            @click="activePlatformTab = platform.id"
          >
            {{ platform.icon }} {{ platform.name }}
          </button>
          <button
            v-if="hasZhihuPersonalSettings && !selectedPersonalPlatformIds.has('zhihu')"
            class="rounded-md border px-3 py-1.5 text-xs font-bold transition"
            :class="activePlatformTab === 'zhihu' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'"
            type="button"
            @click="activePlatformTab = 'zhihu'"
          >
            ZH 知乎
          </button>
        </div>

        <div v-if="activePlatformTab" class="grid gap-3">
          <!-- B站个性化设置 -->
          <template v-if="activePlatformTab === 'bilibili'">
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                :checked="Boolean(draft.platformSettings?.bilibili?.commercialPromotion ?? true)"
                @change="onPlatformSettingChange('bilibili', 'commercialPromotion', ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm font-bold text-slate-700">商业推广</span>
              <span class="text-[11px] text-slate-400">勾选后标记为商业推广内容</span>
            </label>
            <label class="grid gap-1.5">
              <span class="pf-label-sm">创作声明</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.bilibili?.declaration || '内容无需标注'"
                @change="onPlatformSettingChange('bilibili', 'declaration', ($event.target as HTMLSelectElement).value)"
              >
                <option value="内容无需标注">内容无需标注</option>
                <option value="含AI生成内容">含AI生成内容</option>
                <option value="含虚构演绎内容">含虚构演绎内容</option>
                <option value="内容含营销信息">内容含营销信息</option>
                <option value="个人观点，仅供参考">个人观点，仅供参考</option>
                <option value="内容为转载">内容为转载</option>
              </select>
            </label>
            <label class="grid gap-1.5">
              <span class="pf-label-sm">分区</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.bilibili?.category || ''"
                @change="onPlatformSettingChange('bilibili', 'category', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">不设置</option>
                <option value="影视">影视</option>
                <option value="娱乐">娱乐</option>
                <option value="音乐">音乐</option>
                <option value="舞蹈">舞蹈</option>
                <option value="动画">动画</option>
                <option value="绘画">绘画</option>
                <option value="鬼畜">鬼畜</option>
                <option value="游戏">游戏</option>
                <option value="资讯">资讯</option>
                <option value="知识">知识</option>
                <option value="人工智能">人工智能</option>
                <option value="科技数码">科技数码</option>
                <option value="汽车">汽车</option>
                <option value="时尚美妆">时尚美妆</option>
                <option value="家装房产">家装房产</option>
                <option value="户外潮流">户外潮流</option>
                <option value="健身">健身</option>
                <option value="体育运动">体育运动</option>
                <option value="手工">手工</option>
                <option value="美食">美食</option>
                <option value="小剧场">小剧场</option>
                <option value="旅游出行">旅游出行</option>
                <option value="三农">三农</option>
                <option value="动物">动物</option>
                <option value="亲子">亲子</option>
                <option value="健康">健康</option>
                <option value="情感">情感</option>
                <option value="vlog">vlog</option>
                <option value="生活兴趣">生活兴趣</option>
                <option value="生活经验">生活经验</option>
              </select>
            </label>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                :checked="Boolean(draft.platformSettings?.bilibili?.keepAutoTags ?? false)"
                @change="onPlatformSettingChange('bilibili', 'keepAutoTags', ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm font-bold text-slate-700">保留系统自动标签</span>
              <span class="text-[11px] text-slate-400">不勾选则先清除页面已有标签再填入</span>
            </label>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                :checked="Boolean(draft.platformSettings?.bilibili?.autoSyncSpaceCover ?? true)"
                @change="onPlatformSettingChange('bilibili', 'autoSyncSpaceCover', ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm font-bold text-slate-700">自动同步 16:9 封面</span>
              <span class="text-[11px] text-slate-400">出现横竖封面提示时默认点击“确认同步”</span>
            </label>
          </template>

          <!-- 微博个性化设置 -->
          <template v-if="activePlatformTab === 'weibo'">
            <label class="grid gap-1.5">
              <span class="pf-label-sm">内容声明（必填）</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.weibo?.declaration || '内容无需标注'"
                @change="onPlatformSettingChange('weibo', 'declaration', ($event.target as HTMLSelectElement).value)"
              >
                <option value="内容无需标注">内容无需标注</option>
                <option value="内容为转载">内容为转载</option>
                <option value="含AI生成内容">含AI生成内容</option>
                <option value="含虚构演绎内容">含虚构演绎内容</option>
                <option value="个人观点，仅供参考">个人观点，仅供参考</option>
                <option value="内容含营销信息">内容含营销信息</option>
              </select>
            </label>
          </template>

          <!-- 抖音个性化设置 -->
          <template v-if="activePlatformTab === 'douyin'">
            <label class="grid gap-1.5">
              <span class="pf-label-sm">自主声明</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.douyin?.declaration || '无需添加自主声明'"
                @change="onPlatformSettingChange('douyin', 'declaration', ($event.target as HTMLSelectElement).value)"
              >
                <option value="无需添加自主声明">无需添加自主声明</option>
                <option value="内容由AI生成">内容由AI生成</option>
                <option value="内容为个人观点或见解">内容为个人观点或见解</option>
                <option value="内容为转载信息">内容为转载信息</option>
                <option value="内容含营销推广信息">内容含营销推广信息</option>
                <option value="虚构演绎，仅供娱乐">虚构演绎，仅供娱乐</option>
              </select>
            </label>
          </template>

          <!-- 快手个性化设置 -->
          <template v-if="activePlatformTab === 'kuaishou'">
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                :checked="Boolean(draft.platformSettings?.kuaishou?.allowDuet ?? true)"
                @change="onPlatformSettingChange('kuaishou', 'allowDuet', ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm font-bold text-slate-700">允许别人跟我拍同框</span>
            </label>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                :checked="Boolean(draft.platformSettings?.kuaishou?.allowDownload ?? true)"
                @change="onPlatformSettingChange('kuaishou', 'allowDownload', ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm font-bold text-slate-700">允许下载此作品</span>
            </label>
          </template>

          <!-- 小红书个性化设置 -->
          <template v-if="activePlatformTab === 'xiaohongshu'">
            <label class="grid gap-1.5">
              <span class="pf-label-sm">内容类型声明</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.xiaohongshu?.contentTypeDeclaration || '不设置'"
                @change="onPlatformSettingChange('xiaohongshu', 'contentTypeDeclaration', ($event.target as HTMLSelectElement).value)"
              >
                <option value="不设置">不设置</option>
                <option value="虚构演绎，仅供娱乐">虚构演绎，仅供娱乐</option>
                <option value="笔记含AI合成内容">笔记含AI合成内容</option>
                <option value="内容包含营销广告">内容包含营销广告</option>
                <option value="内容来源声明">内容来源声明</option>
              </select>
            </label>
          </template>

          <!-- 视频号个性化设置 -->
          <template v-if="activePlatformTab === 'weixinChannels'">
            <p class="text-xs text-slate-400">视频号暂无额外个性化设置。</p>
          </template>

          <!-- 知乎个性化设置 -->
          <template v-if="activePlatformTab === 'zhihu'">
            <label class="grid gap-1.5">
              <span class="pf-label-sm">视频标记</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.zhihu?.declaration || '内容无需标注'"
                @change="onPlatformSettingChange('zhihu', 'declaration', ($event.target as HTMLSelectElement).value)"
              >
                <option value="内容无需标注">内容无需标注</option>
                <option value="含 AI 生成内容">含 AI 生成内容</option>
                <option value="含虚构演绎内容">含虚构演绎内容</option>
                <option value="内容含营销信息">内容含营销信息</option>
                <option value="内容为转载">内容为转载</option>
                <option value="个人观点仅供参考">个人观点仅供参考</option>
              </select>
            </label>
            <label class="grid gap-1.5">
              <span class="pf-label-sm">所属领域</span>
              <select
                class="pf-input-accent"
                :value="draft.platformSettings?.zhihu?.domain || ''"
                @change="onPlatformSettingChange('zhihu', 'domain', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">不设置</option>
                <option value="人文">人文</option>
                <option value="体育竞技">体育竞技</option>
                <option value="健康医学">健康医学</option>
                <option value="其他">其他</option>
                <option value="军事">军事</option>
                <option value="动漫">动漫</option>
                <option value="娱乐">娱乐</option>
                <option value="宠物">宠物</option>
                <option value="家居生活">家居生活</option>
                <option value="家用电器">家用电器</option>
                <option value="影视">影视</option>
                <option value="心理学">心理学</option>
                <option value="情感">情感</option>
                <option value="故事">故事</option>
                <option value="教育">教育</option>
                <option value="数码">数码</option>
                <option value="旅行">旅行</option>
                <option value="时尚穿搭">时尚穿搭</option>
                <option value="母婴亲子">母婴亲子</option>
                <option value="汽车">汽车</option>
                <option value="法律">法律</option>
                <option value="游戏电竞">游戏电竞</option>
                <option value="社会/时政">社会/时政</option>
                <option value="社会学">社会学</option>
                <option value="科学工程">科学工程</option>
                <option value="科技互联网">科技互联网</option>
                <option value="经济与管理">经济与管理</option>
                <option value="美妆个护">美妆个护</option>
                <option value="美食">美食</option>
                <option value="职场">职场</option>
                <option value="艺术">艺术</option>
                <option value="运动健身">运动健身</option>
                <option value="音乐">音乐</option>
              </select>
            </label>
          </template>
        </div>

        <div v-else class="text-xs text-slate-400">
          请先选择目标平台，然后点击上方平台标签查看个性化设置。
        </div>
      </section>

      <section class="pf-card-padded-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="pf-section-title">活动推荐</h2>
            <p class="mt-1 text-[11px] text-slate-500">根据标题、描述和已选平台推荐当前更值得挂钩的官方入口。</p>
          </div>
          <div class="text-[11px] text-slate-400">{{ selectedCampaignIds.length }} 已勾选</div>
        </div>

        <div v-if="campaignRecommendations.length" class="mt-3 grid gap-2.5">
          <div
            v-for="item in campaignRecommendations"
            :key="item.活动.标识"
            class="rounded-md border px-3 py-3"
            :class="selectedCampaignIds.includes(item.活动.标识) ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-slate-50/70'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-black text-slate-900">{{ item.活动.标题 }}</span>
                  <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{{ platforms.find((platform) => platform.id === item.活动.平台标识)?.name }}</span>
                  <span class="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{{ campaignTypeText(item.活动.类型) }}</span>
                </div>
                <p class="mt-1 text-xs leading-5 text-slate-600">{{ item.活动.简介 }}</p>
              </div>
              <div class="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black text-amber-600 ring-1 ring-amber-200">
                匹配 {{ item.得分 }}
              </div>
            </div>

            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="reason in item.推荐理由"
                :key="reason"
                class="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200"
              >
                {{ reason }}
              </span>
            </div>

            <div class="mt-3 rounded-md bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-500 ring-1 ring-slate-200">
              {{ item.活动.参与提示 }}
            </div>

            <div class="mt-3 flex items-center justify-between gap-2">
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="tag in item.活动.标签.slice(0, 4)"
                  :key="tag"
                  class="rounded-full bg-slate-900/5 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                >
                  {{ tag }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:border-blue-400 hover:text-blue-600"
                  type="button"
                  @click="emit('openCampaign', item.活动.官方链接)"
                >
                  查看入口
                </button>
                <button
                  class="rounded-md px-2.5 py-1.5 text-[11px] font-bold"
                  :class="selectedCampaignIds.includes(item.活动.标识) ? 'bg-amber-500 text-white hover:bg-amber-600' : 'border border-amber-300 bg-white text-amber-700 hover:bg-amber-50'"
                  type="button"
                  @click="emit('toggleCampaign', item.活动.标识)"
                >
                  {{ selectedCampaignIds.includes(item.活动.标识) ? '已勾选' : '勾选' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-400">
          先选择目标平台，并补充标题、描述或话题，才能给出更准确的活动推荐。
        </div>

        <div v-if="selectedCampaigns.length" class="mt-3 border-t border-slate-100 pt-3">
          <div class="text-[11px] font-bold text-slate-500">已勾选活动</div>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="活动 in selectedCampaigns"
              :key="活动.标识"
              class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"
              type="button"
              @click="emit('openCampaign', 活动.官方链接)"
            >
              <span>{{ 活动.简称 }}</span>
              <span class="text-white/60">{{ platforms.find((platform) => platform.id === 活动.平台标识)?.icon }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <aside class="grid h-fit gap-5">
      <section class="pf-card-padded-sm">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="pf-section-title">手机预览</h2>
          <span class="text-[11px] text-slate-400">{{ uploadTab === 'video' ? '视频' : uploadTab === 'image' ? '图文' : '文章' }}</span>
        </div>
        <PhonePreview
          :draft="draft"
          :mode="uploadTab"
          :video-url="videoPreviewUrl"
          :cover-url="coverPreviewUrl"
          :image-urls="imagePreviewUrls"
          :music-playing="previewMusicPlaying"
          :article-content="previewArticleContent"
        />
      </section>

      <section class="pf-card-padded-sm">
        <h2 class="pf-section-title">封面</h2>
        <div class="relative mt-3 overflow-hidden rounded-md border border-slate-200">
          <img v-if="coverPreviewUrl" class="h-40 w-full object-cover" :src="coverPreviewUrl" alt="封面预览" />
          <div v-else class="grid h-40 place-items-center bg-slate-50 text-xs font-bold text-slate-400">暂无封面，点击选择</div>
          <input class="absolute inset-0 cursor-pointer opacity-0" type="file" accept="image/*" @change="emit('setCoverFile', $event)" />
        </div>
        <div class="mt-2 text-xs text-slate-400">{{ draft.coverFileName || '支持 jpg/png，推荐 1080x1440' }}</div>
      </section>

      <section class="pf-card-padded-sm">
        <div class="flex items-center justify-between">
          <h2 class="pf-section-title">目标平台</h2>
          <button
            class="text-[11px] font-bold text-rose-500 hover:text-rose-700"
            type="button"
            @click="toggleAllPlatforms"
          >{{ allPlatformsSelected ? '清空' : '全选' }}</button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button
            v-for="platform in platforms"
            :key="platform.id"
            class="flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold transition"
            :class="!isPlatformSelectable(platform)
              ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
              : draft.selectedPlatforms.includes(platform.id)
                ? 'border-rose-500 bg-rose-50 text-rose-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'"
            type="button"
            :disabled="!isPlatformSelectable(platform)"
            :title="isPlatformSelectable(platform) ? '' : `当前内容类型不支持${platform.name}`"
            @click="isPlatformSelectable(platform) && emit('togglePlatform', platform.id)"
          >
            <span
              class="grid h-5 w-7 place-items-center rounded text-[9px] font-black"
              :class="isPlatformSelectable(platform) ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-300'"
            >{{ platform.icon }}</span>
            {{ platform.name }}
          </button>
        </div>
      </section>

      <section class="pf-card-padded-sm">
        <h2 class="pf-section-title">任务状态</h2>
        <div v-if="activeTasks.length" class="mt-3 grid gap-2">
          <div v-for="item in activeTasks" :key="item.id" class="rounded-md border border-slate-100 bg-slate-50 p-2.5">
            <div class="truncate text-xs font-bold text-slate-800">{{ item.title }}</div>
            <div class="mt-1 text-[11px] text-slate-500">{{ item.detail }} · {{ statusText(item.status) }}</div>
          </div>
        </div>
        <p v-else class="mt-3 text-xs text-slate-400">暂无任务。</p>
      </section>
    </aside>
  </div>
</template>
