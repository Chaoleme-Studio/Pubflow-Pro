<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Activity,
  Check,
  FileText,
  Film,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  Lock,
  LogOut,
  RefreshCw,
  Upload,
  Users,
  X,
} from 'lucide-vue-next';
import {
  createRequestId,
  isRemoteSessionExpiredError,
  remotePublishApi,
  sha256,
  type CreateRemoteJob,
  type RemoteAssetDescriptor,
  type RemoteChannelTest,
  type RemoteJob,
  type RemotePublishMode,
  type RemoteQuota,
  type RemoteSession,
  type PublishTransport,
} from '../remotePublishApi';
import { localPublishApi, selectLocalWorkspace } from '../localPublishApi';

type ContentType = 'video' | 'image' | 'article';
type AssetRole = Exclude<RemoteAssetDescriptor['role'], 'music'>;
type CoverAspectRatio = '4:3' | '3:4' | '9:16' | '16:9';
type Visibility = CreateRemoteJob['visibility'];
type ChannelState = 'untested' | 'testing' | 'connected' | 'failed';

interface SelectedAsset {
  role: AssetRole;
  file: File;
  previewUrl: string;
}

const platforms = [
  { id: 'douyin', label: '抖音' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'weixinChannels', label: '视频号' },
  { id: 'bilibili', label: '哔哩哔哩' },
  { id: 'kuaishou', label: '快手' },
  { id: 'weibo', label: '微博' },
  { id: 'zhihu', label: '知乎' },
] as const;

const configurablePlatformIds = new Set([
  'douyin', 'xiaohongshu', 'weixinChannels', 'bilibili', 'kuaishou', 'weibo', 'zhihu',
]);

const contentTypes = [
  { id: 'video' as const, label: '视频', icon: Film },
  { id: 'image' as const, label: '图文', icon: Images },
  { id: 'article' as const, label: '文章', icon: FileText },
];

const visibilityOptions = [
  { value: 'public' as const, label: '公开', icon: Globe2 },
  { value: 'friends' as const, label: '好友可见', icon: Users },
  { value: 'private' as const, label: '仅自己', icon: Lock },
];

const coverAspectOptions: CoverAspectRatio[] = ['4:3', '3:4', '9:16', '16:9'];
const coverAspectClass: Record<CoverAspectRatio, string> = {
  '4:3': 'ratio-4-3',
  '3:4': 'ratio-3-4',
  '9:16': 'ratio-9-16',
  '16:9': 'ratio-16-9',
};

const bilibiliCategories = [
  '影视', '娱乐', '音乐', '舞蹈', '动画', '绘画', '鬼畜', '游戏', '资讯', '知识',
  '人工智能', '科技数码', '汽车', '时尚美妆', '家装房产', '户外潮流', '健身',
  '体育运动', '手工', '美食', '小剧场', '旅游出行', '三农', '动物', '亲子',
  '健康', '情感', 'vlog', '生活兴趣', '生活经验',
];

const zhihuDomains = [
  '人文', '体育竞技', '健康医学', '其他', '军事', '动漫', '娱乐', '宠物', '家居生活',
  '家用电器', '影视', '心理学', '情感', '故事', '教育', '数码', '旅行', '时尚穿搭', '母婴亲子',
  '汽车', '法律', '游戏电竞', '社会/时政', '社会学', '科学工程', '科技互联网', '经济与管理',
  '美妆个护', '美食', '职场', '艺术', '运动健身', '音乐',
];

const booting = ref(true);
const localMode = ref(false);
let publishApi: PublishTransport = remotePublishApi;
const authenticated = ref(false);
const loginCredential = ref('');
const session = ref<RemoteSession | null>(null);
const quota = ref<RemoteQuota | null>(null);
const jobs = ref<RemoteJob[]>([]);
const contentType = ref<ContentType>('video');
const title = ref('');
const description = ref('');
const articleContent = ref('');
const topics = ref('');
const selectedPlatforms = ref<string[]>(platforms.map(({ id }) => id));
const selectedAssets = ref<SelectedAsset[]>([]);
const coverAspectRatio = ref<CoverAspectRatio>('4:3');
const scheduleEnabled = ref(false);
const scheduledAt = ref('');
const visibility = ref<Visibility>('public');
const originalDeclare = ref(false);
const publishMode = ref<RemotePublishMode>('auto_submit');
const activePlatformTab = ref('douyin');
const platformSettings = ref<Record<string, Record<string, unknown>>>({
  bilibili: {
    commercialPromotion: true,
    declaration: '内容无需标注',
    category: '',
    keepAutoTags: false,
    autoSyncSpaceCover: true,
  },
  weibo: { declaration: '内容无需标注' },
  douyin: { declaration: '无需添加自主声明' },
  kuaishou: { allowDuet: true, allowDownload: true },
  xiaohongshu: { contentTypeDeclaration: '不设置' },
  weixinChannels: { videoMark: '无需标注' },
  zhihu: { declaration: '内容无需标注', domain: '' },
});
const busy = ref(false);
const notice = ref('');
const uploadProgress = ref(0);
const channelState = ref<ChannelState>('untested');
const channelResult = ref<RemoteChannelTest | null>(null);
const channelError = ref('');
const channelVerifiedAt = ref(0);
const videoInput = ref<HTMLInputElement | null>(null);
const coverInput = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);

const videoAsset = computed(() => selectedAssets.value.find((asset) => asset.role === 'video') || null);
const coverAsset = computed(() => selectedAssets.value.find((asset) => asset.role === 'cover') || null);
const imageAssets = computed(() => selectedAssets.value.filter((asset) => asset.role === 'image'));
const topicCount = computed(() => parseTopics().length);
const configuredPlatforms = computed(() => platforms.filter(
  ({ id }) => selectedPlatforms.value.includes(id) && configurablePlatformIds.has(id),
));
const quotaPercent = computed(() => quota.value
  && !quota.value.unlimited && quota.value.byteLimit > 0
  ? Math.min(100, (quota.value.bytesUsed / quota.value.byteLimit) * 100)
  : 0);
const submitDisabled = computed(() => busy.value || channelState.value === 'testing'
  || !title.value.trim() || !selectedPlatforms.value.length
  || (contentType.value === 'video' && !videoAsset.value)
  || (contentType.value === 'image' && !imageAssets.value.length)
  || (contentType.value === 'article' && !articleContent.value.trim()));
const channelLabel = computed(() => ({
  untested: '尚未检测',
  testing: '检测中',
  connected: '通道已连通',
  failed: '通道不可用',
})[channelState.value]);

watch(configuredPlatforms, (next) => {
  if (!next.some(({ id }) => id === activePlatformTab.value)) {
    activePlatformTab.value = next[0]?.id || '';
  }
});

onMounted(async () => {
  localMode.value = new URLSearchParams(window.location.search).get('transport') === 'local';
  publishApi = localMode.value ? localPublishApi : remotePublishApi;
  try {
    session.value = await publishApi.session();
    authenticated.value = true;
    await refreshData();
    void testChannel();
  } catch {
    authenticated.value = false;
  } finally {
    booting.value = false;
  }
});

onUnmounted(clearSelectedAssets);

async function login() {
  if (!loginCredential.value.trim() || busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    session.value = await publishApi.login(loginCredential.value.trim());
    resetChannelState();
    await refreshData();
    loginCredential.value = '';
    authenticated.value = true;
    void testChannel();
  } catch (error) {
    authenticated.value = false;
    session.value = null;
    notice.value = /INVALID_TOKEN/i.test(messageOf(error))
      ? (localMode.value ? '本地访问密码错误。' : '激活码无效或已失效。')
      : messageOf(error);
  } finally {
    busy.value = false;
  }
}

async function chooseLocalWorkspace() {
  if (!localMode.value || busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    const result = await selectLocalWorkspace();
    if (!result.selected) {
      notice.value = '未更改工作区。';
      return;
    }
    const name = result.directoryName ? `“${result.directoryName}”` : '新工作区';
    notice.value = result.restartRequired
      ? `已选择${name}，请重启 PubFlow Native 后生效。`
      : `当前已经使用${name}。`;
  } catch (error) {
    notice.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await publishApi.logout().catch(() => undefined);
  authenticated.value = false;
  session.value = null;
  quota.value = null;
  jobs.value = [];
  resetChannelState();
  clearSelectedAssets();
}

async function refreshData() {
  const [nextQuota, nextJobs] = await Promise.all([
    publishApi.quota(),
    publishApi.jobs(),
  ]);
  quota.value = nextQuota;
  jobs.value = nextJobs;
}

async function testChannel() {
  if (channelState.value === 'testing') return false;
  channelState.value = 'testing';
  channelError.value = '';
  try {
    channelResult.value = await publishApi.testChannel();
    channelVerifiedAt.value = Date.now();
    channelState.value = 'connected';
    return true;
  } catch (error) {
    if (handleRemoteSessionExpired(error)) return false;
    channelResult.value = null;
    channelVerifiedAt.value = 0;
    channelState.value = 'failed';
    channelError.value = messageOf(error);
    return false;
  }
}

function handleRemoteSessionExpired(error: unknown) {
  if (localMode.value || !isRemoteSessionExpiredError(error)) return false;
  authenticated.value = false;
  session.value = null;
  quota.value = null;
  jobs.value = [];
  resetChannelState();
  notice.value = error.message;
  return true;
}

function resetChannelState() {
  channelState.value = 'untested';
  channelResult.value = null;
  channelError.value = '';
  channelVerifiedAt.value = 0;
}

async function ensureChannelReady() {
  if (channelState.value === 'connected' && Date.now() - channelVerifiedAt.value < 10_000) {
    return true;
  }
  return testChannel();
}

function switchType(type: ContentType) {
  if (contentType.value === type) return;
  contentType.value = type;
  clearSelectedAssets();
}

function chooseVideo() {
  videoInput.value?.click();
}

function chooseCover() {
  coverInput.value?.click();
}

function chooseImages() {
  imageInput.value?.click();
}

function setSingleAsset(role: Exclude<AssetRole, 'image'>, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  removeAssetsByRole(role);
  if (file) selectedAssets.value.push(createSelectedAsset(role, file));
  input.value = '';
}

function setImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files || [])];
  removeAssetsByRole('image');
  selectedAssets.value.push(...files.map((file) => createSelectedAsset('image', file)));
  input.value = '';
}

function createSelectedAsset(role: AssetRole, file: File): SelectedAsset {
  return { role, file, previewUrl: URL.createObjectURL(file) };
}

function removeAssetsByRole(role: AssetRole) {
  selectedAssets.value.filter((asset) => asset.role === role).forEach(revokePreview);
  selectedAssets.value = selectedAssets.value.filter((asset) => asset.role !== role);
}

function removeAsset(asset: SelectedAsset) {
  revokePreview(asset);
  selectedAssets.value = selectedAssets.value.filter((item) => item !== asset);
}

function clearSelectedAssets() {
  selectedAssets.value.forEach(revokePreview);
  selectedAssets.value = [];
}

function revokePreview(asset: SelectedAsset) {
  URL.revokeObjectURL(asset.previewUrl);
}

function holdVideoFirstFrame(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  video.pause();
  video.currentTime = 0;
}

function toggleSchedule(event: Event) {
  scheduleEnabled.value = (event.target as HTMLInputElement).checked;
  if (scheduleEnabled.value && !scheduledAt.value) {
    const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const local = new Date(next.getTime() - next.getTimezoneOffset() * 60_000);
    scheduledAt.value = local.toISOString().slice(0, 16);
  }
}

function settingValue<T>(platformId: string, key: string, fallback: T): T {
  return (platformSettings.value[platformId]?.[key] as T | undefined) ?? fallback;
}

function setPlatformSetting(platformId: string, key: string, value: unknown) {
  platformSettings.value = {
    ...platformSettings.value,
    [platformId]: {
      ...(platformSettings.value[platformId] || {}),
      [key]: value,
    },
  };
}

async function submit() {
  if (submitDisabled.value) return;
  if (!await ensureChannelReady()) return;
  busy.value = true;
  notice.value = '';
  uploadProgress.value = 0;
  try {
    const descriptors: RemoteAssetDescriptor[] = [];
    for (const asset of selectedAssets.value) {
      descriptors.push({
        role: asset.role,
        fileName: asset.file.name,
        contentType: asset.file.type || undefined,
        size: asset.file.size,
        sha256: await sha256(asset.file),
      });
    }
    const payload: CreateRemoteJob = {
      requestId: createRequestId(),
      contentType: contentType.value,
      title: title.value.trim(),
      description: description.value.trim(),
      articleContent: contentType.value === 'article' ? articleContent.value : undefined,
      topics: parseTopics(),
      campaignIds: [],
      platforms: selectedPlatforms.value,
      scheduledAt: scheduleEnabled.value && scheduledAt.value
        ? new Date(scheduledAt.value).getTime()
        : undefined,
      visibility: visibility.value,
      originalDeclare: originalDeclare.value,
      platformSettings: Object.fromEntries(
        selectedPlatforms.value.map((id) => [id, platformSettings.value[id] || {}]),
      ),
      assets: descriptors,
      publishMode: publishMode.value,
    };
    const job = await publishApi.createJob(payload);
    const progress = new Map<string, number>();
    for (let index = 0; index < selectedAssets.value.length; index += 1) {
      const selected = selectedAssets.value[index];
      const descriptor = descriptors[index];
      const remote = job.assets.find((asset) => asset.role === descriptor.role
        && asset.fileName === descriptor.fileName && asset.sha256 === descriptor.sha256);
      if (!remote) throw new Error(`服务端未返回素材 ${descriptor.fileName} 的上传地址。`);
      await publishApi.uploadAsset(job.jobId, remote.assetId, selected.file, (loaded) => {
        progress.set(remote.assetId, loaded);
        const uploaded = [...progress.values()].reduce((sum, value) => sum + value, 0);
        uploadProgress.value = job.declaredBytes
          ? Math.round((uploaded / job.declaredBytes) * 100)
          : 100;
      });
    }
    await publishApi.completeJob(job.jobId);
    notice.value = publishMode.value === 'auto_submit'
      ? '任务已提交，插件将在空闲后自动领取并发布。'
      : '任务已提交，插件填充完成后将保留发布页等待确认。';
    resetForm();
    await refreshData();
  } catch (error) {
    if (!handleRemoteSessionExpired(error)) notice.value = messageOf(error);
  } finally {
    busy.value = false;
  }
}

function resetForm() {
  title.value = '';
  description.value = '';
  articleContent.value = '';
  topics.value = '';
  clearSelectedAssets();
  uploadProgress.value = 0;
}

function parseTopics() {
  return topics.value
    .split(/[，,\s]+/)
    .map((value) => value.trim().replace(/^#/, ''))
    .filter(Boolean);
}

function formatBytes(value: number) {
  const amount = value < 1024 * 1024 ? value / 1024 : value / 1024 / 1024;
  const unit = value < 1024 * 1024 ? 'KB' : 'MB';
  return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function statusLabel(status: string) {
  return ({
    uploading: '待上传',
    queued: '排队中',
    claimed: '已领取',
    materialized: '已接收',
    running: '发布中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  } as Record<string, string>)[status] || status;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}
</script>

<template>
  <main class="remote-publish">
    <div v-if="booting" class="boot-state"><LoaderCircle class="spin" :size="24" /></div>

    <section v-else-if="!authenticated" class="login-shell">
      <div class="login-brand"><img src="/icon.svg" alt="" /><strong>PubFlow</strong></div>
      <form class="login-form" @submit.prevent="login">
        <h1>{{ localMode ? '本地发布' : '远程发布' }}</h1>
        <label for="login-credential">{{ localMode ? '本地访问密码' : '激活码' }}</label>
        <input
          id="login-credential"
          v-model="loginCredential"
          :type="localMode ? 'password' : 'text'"
          :autocomplete="localMode ? 'current-password' : 'one-time-code'"
          :placeholder="localMode ? '请输入本地访问密码' : 'PF-XXXXXXXXXXXXXXXX'"
        />
        <button type="submit" :disabled="busy || !loginCredential.trim()">
          <LoaderCircle v-if="busy" class="spin" :size="18" />
          <span>登录</span>
        </button>
        <p v-if="notice" class="form-error">{{ notice }}</p>
      </form>
    </section>

    <template v-else>
      <header class="publish-header">
        <div class="header-brand"><img src="/icon.svg" alt="" /><span>PubFlow</span><strong>{{ localMode ? '本地发布' : '远程发布' }}</strong></div>
        <div class="header-actions">
          <button v-if="localMode" class="icon-button" type="button" title="重新选择工作区" :disabled="busy" @click="chooseLocalWorkspace"><FolderOpen :size="18" /></button>
          <button class="icon-button" type="button" title="刷新" @click="refreshData"><RefreshCw :size="18" /></button>
          <button class="icon-button" type="button" title="退出" @click="logout"><LogOut :size="18" /></button>
        </div>
      </header>

      <section v-if="quota" class="quota-band">
        <template v-if="quota.unlimited">
          <div><span>任务额度</span><strong>不限量</strong></div>
          <div><span>素材流量</span><strong>仅局域网传输</strong></div>
        </template>
        <template v-else>
          <div><span>今日任务</span><strong>{{ quota.jobsUsed }} / {{ quota.jobLimit }}</strong></div>
          <div><span>今日流量</span><strong>{{ formatBytes(quota.bytesUsed) }} / {{ formatBytes(quota.byteLimit) }}</strong></div>
          <div class="quota-track"><i :style="{ width: `${quotaPercent}%` }" /></div>
        </template>
      </section>

      <section class="channel-band" :data-state="channelState">
        <div class="channel-status">
          <span class="channel-icon"><Activity :size="18" /></span>
          <div>
            <span>插件通道</span>
            <strong>{{ channelLabel }}</strong>
          </div>
          <small v-if="channelResult">{{ channelResult.latencyMs }} ms<span v-if="channelResult.extensionVersion"> · v{{ channelResult.extensionVersion }}</span></small>
          <small v-else-if="channelError">{{ channelError }}</small>
        </div>
        <button type="button" class="secondary-button" :disabled="channelState === 'testing'" @click="testChannel">
          <LoaderCircle v-if="channelState === 'testing'" class="spin" :size="16" />
          <Activity v-else :size="16" />
          测试通道
        </button>
      </section>

      <div class="publish-layout">
        <form class="publish-form" @submit.prevent="submit">
          <div class="type-control" role="tablist" aria-label="内容类型">
            <button v-for="item in contentTypes" :key="item.id" type="button" :class="{ active: contentType === item.id }" @click="switchType(item.id)">
              <component :is="item.icon" :size="17" />{{ item.label }}
            </button>
          </div>

          <div class="media-grid">
            <section v-if="contentType === 'video'" class="tool-section video-tool">
              <div class="tool-header">
                <h2>视频文件</h2>
                <button v-if="videoAsset" type="button" class="text-button" @click="chooseVideo"><RefreshCw :size="14" />替换视频</button>
              </div>
              <button v-if="!videoAsset" type="button" class="upload-zone" @click="chooseVideo">
                <span class="upload-icon"><Upload :size="25" /></span>
                <strong>选择视频文件</strong>
                <small>mp4 / webm / mov</small>
              </button>
              <template v-else>
                <div class="video-player"><video :src="videoAsset.previewUrl" controls preload="metadata" /></div>
                <div class="file-meta"><strong>{{ videoAsset.file.name }}</strong><span>{{ formatBytes(videoAsset.file.size) }}</span></div>
              </template>
              <input ref="videoInput" class="visually-hidden" type="file" accept="video/mp4,video/webm,video/quicktime" @change="setSingleAsset('video', $event)" />
            </section>

            <section v-else class="tool-section image-tool">
              <div class="tool-header">
                <h2>{{ contentType === 'image' ? '图片文件' : '正文图片' }}</h2>
                <button v-if="imageAssets.length" type="button" class="text-button" @click="chooseImages"><RefreshCw :size="14" />重新选择</button>
              </div>
              <button v-if="!imageAssets.length" type="button" class="upload-zone" @click="chooseImages">
                <span class="upload-icon"><Images :size="25" /></span>
                <strong>选择图片文件</strong>
                <small>jpg / png / webp</small>
              </button>
              <div v-else class="image-preview-grid">
                <article v-for="asset in imageAssets" :key="asset.previewUrl">
                  <img :src="asset.previewUrl" :alt="asset.file.name" />
                  <button type="button" title="移除图片" @click="removeAsset(asset)"><X :size="15" /></button>
                </article>
              </div>
              <input ref="imageInput" class="visually-hidden" type="file" accept="image/*" multiple @change="setImages" />
            </section>

            <section class="tool-section cover-tool">
              <div class="tool-header cover-header">
                <h2>封面</h2>
                <div class="ratio-control" role="group" aria-label="封面预览比例">
                  <button v-for="ratio in coverAspectOptions" :key="ratio" type="button" :class="{ active: coverAspectRatio === ratio }" :aria-pressed="coverAspectRatio === ratio" @click="coverAspectRatio = ratio">{{ ratio }}</button>
                </div>
              </div>
              <button type="button" class="cover-stage" title="选择或更换封面" @click="chooseCover">
                <span class="cover-frame" :class="coverAspectClass[coverAspectRatio]">
                  <img v-if="coverAsset" :src="coverAsset.previewUrl" alt="封面预览" />
                  <video v-else-if="contentType === 'video' && videoAsset" :src="videoAsset.previewUrl" muted playsinline preload="auto" @loadeddata="holdVideoFirstFrame" />
                  <span v-else class="cover-empty"><ImageIcon :size="24" />暂无封面</span>
                </span>
              </button>
              <div class="cover-footer">
                <span>{{ coverAsset?.file.name || (videoAsset ? '当前显示视频首帧' : '支持 jpg / png / webp') }}</span>
                <button type="button" class="text-button" @click="chooseCover">{{ coverAsset ? '更换封面' : '选择封面' }}</button>
              </div>
              <input ref="coverInput" class="visually-hidden" type="file" accept="image/*" @change="setSingleAsset('cover', $event)" />
            </section>
          </div>

          <section class="form-section">
            <h2>发布信息</h2>
            <div class="field-grid">
              <label class="field field-wide"><span>{{ contentType === 'article' ? '文章标题' : '标题' }}</span><input v-model="title" :maxlength="contentType === 'article' ? 30 : 80" :placeholder="contentType === 'article' ? '请输入文章标题，最多30字' : '请输入作品标题'" required /></label>
              <label v-if="contentType !== 'article' || selectedPlatforms.includes('douyin')" class="field field-wide"><span>{{ contentType === 'article' ? '文章摘要' : '作品描述' }}</span><textarea v-model="description" rows="3" :maxlength="contentType === 'article' ? 30 : 10000" :placeholder="contentType === 'article' ? '添加内容摘要吸引用户阅读' : '添加作品简介和亮点'" /></label>
              <label v-if="contentType === 'article'" class="field field-wide"><span>文章正文</span><textarea v-model="articleContent" rows="10" required /></label>
              <label class="field field-wide"><span>话题 <small>{{ topicCount }} 个</small></span><input v-model="topics" placeholder="#话题1 #话题2" /></label>
            </div>
          </section>

          <fieldset class="form-section platform-picker">
            <legend>发布平台</legend>
            <label v-for="platform in platforms" :key="platform.id">
              <input v-model="selectedPlatforms" type="checkbox" :value="platform.id" />
              <span><Check :size="14" />{{ platform.label }}</span>
            </label>
          </fieldset>

          <section class="form-section publish-settings">
            <h2>发布设置</h2>
            <div class="setting-block publish-mode-setting">
              <span>提交方式</span>
              <div class="mode-control" role="radiogroup" aria-label="提交方式">
                <button type="button" role="radio" :aria-checked="publishMode === 'auto_submit'" :class="{ active: publishMode === 'auto_submit' }" @click="publishMode = 'auto_submit'">自动发布</button>
                <button type="button" role="radio" :aria-checked="publishMode === 'fill_only'" :class="{ active: publishMode === 'fill_only' }" @click="publishMode = 'fill_only'">仅填充</button>
              </div>
              <small class="setting-hint">{{ publishMode === 'auto_submit' ? '支持的平台会点击最终发布按钮' : '填充完成后保留发布页，等待手动确认' }}</small>
            </div>
            <div class="setting-row">
              <div><strong>定时发布</strong><small>{{ scheduleEnabled ? '按指定时间发布' : '立即发布' }}</small></div>
              <div class="setting-action">
                <input v-if="scheduleEnabled" v-model="scheduledAt" class="date-input" type="datetime-local" />
                <label class="switch-control"><input :checked="scheduleEnabled" type="checkbox" @change="toggleSchedule" /><span /></label>
              </div>
            </div>
            <div class="setting-block">
              <span>谁可以看</span>
              <div class="visibility-control">
                <button v-for="option in visibilityOptions" :key="option.value" type="button" :class="{ active: visibility === option.value }" @click="visibility = option.value"><component :is="option.icon" :size="14" />{{ option.label }}</button>
              </div>
            </div>
            <label class="check-row"><input v-model="originalDeclare" type="checkbox" /><span><strong>声明原创</strong><small>勾选后各平台将标记为原创内容</small></span></label>
          </section>

          <section v-if="configuredPlatforms.length" class="form-section platform-settings">
            <h2>平台个性化设置</h2>
            <div class="platform-tabs">
              <button v-for="platform in configuredPlatforms" :key="platform.id" type="button" :class="{ active: activePlatformTab === platform.id }" @click="activePlatformTab = platform.id">{{ platform.label }}</button>
            </div>
            <div class="platform-fields">
              <template v-if="activePlatformTab === 'bilibili'">
                <label class="check-row"><input type="checkbox" :checked="settingValue('bilibili', 'commercialPromotion', true)" @change="setPlatformSetting('bilibili', 'commercialPromotion', ($event.target as HTMLInputElement).checked)" /><span><strong>商业推广</strong><small>标记为商业推广内容</small></span></label>
                <label class="field"><span>创作声明</span><select :value="settingValue('bilibili', 'declaration', '内容无需标注')" @change="setPlatformSetting('bilibili', 'declaration', ($event.target as HTMLSelectElement).value)"><option>内容无需标注</option><option>含AI生成内容</option><option>含虚构演绎内容</option><option>内容含营销信息</option><option>个人观点，仅供参考</option><option>内容为转载</option></select></label>
                <label class="field"><span>分区</span><select :value="settingValue('bilibili', 'category', '')" @change="setPlatformSetting('bilibili', 'category', ($event.target as HTMLSelectElement).value)"><option value="">不设置</option><option v-for="category in bilibiliCategories" :key="category" :value="category">{{ category }}</option></select></label>
                <label class="check-row"><input type="checkbox" :checked="settingValue('bilibili', 'keepAutoTags', false)" @change="setPlatformSetting('bilibili', 'keepAutoTags', ($event.target as HTMLInputElement).checked)" /><span><strong>保留系统自动标签</strong><small>不勾选则清除页面已有标签</small></span></label>
                <label class="check-row"><input type="checkbox" :checked="settingValue('bilibili', 'autoSyncSpaceCover', true)" @change="setPlatformSetting('bilibili', 'autoSyncSpaceCover', ($event.target as HTMLInputElement).checked)" /><span><strong>自动同步 16:9 封面</strong><small>横竖封面提示时自动确认同步</small></span></label>
              </template>

              <label v-else-if="activePlatformTab === 'weibo'" class="field"><span>内容声明（必填）</span><select :value="settingValue('weibo', 'declaration', '内容无需标注')" @change="setPlatformSetting('weibo', 'declaration', ($event.target as HTMLSelectElement).value)"><option>内容无需标注</option><option>内容为转载</option><option>含AI生成内容</option><option>含虚构演绎内容</option><option>个人观点，仅供参考</option><option>内容含营销信息</option></select></label>

              <label v-else-if="activePlatformTab === 'douyin'" class="field"><span>自主声明</span><select :value="settingValue('douyin', 'declaration', '无需添加自主声明')" @change="setPlatformSetting('douyin', 'declaration', ($event.target as HTMLSelectElement).value)"><option>无需添加自主声明</option><option>内容由AI生成</option><option>内容为个人观点或见解</option><option>内容为转载信息</option><option>内容含营销推广信息</option><option>虚构演绎，仅供娱乐</option></select></label>

              <template v-else-if="activePlatformTab === 'kuaishou'">
                <label class="check-row"><input type="checkbox" :checked="settingValue('kuaishou', 'allowDuet', true)" @change="setPlatformSetting('kuaishou', 'allowDuet', ($event.target as HTMLInputElement).checked)" /><span><strong>允许别人跟我拍同框</strong></span></label>
                <label class="check-row"><input type="checkbox" :checked="settingValue('kuaishou', 'allowDownload', true)" @change="setPlatformSetting('kuaishou', 'allowDownload', ($event.target as HTMLInputElement).checked)" /><span><strong>允许下载此作品</strong></span></label>
              </template>

              <label v-else-if="activePlatformTab === 'xiaohongshu'" class="field"><span>内容类型声明</span><select :value="settingValue('xiaohongshu', 'contentTypeDeclaration', '不设置')" @change="setPlatformSetting('xiaohongshu', 'contentTypeDeclaration', ($event.target as HTMLSelectElement).value)"><option>不设置</option><option>虚构演绎，仅供娱乐</option><option>笔记含AI合成内容</option><option>内容包含营销广告</option><option>内容来源声明</option></select></label>

              <label v-else-if="activePlatformTab === 'weixinChannels'" class="field"><span>视频标注</span><select :value="settingValue('weixinChannels', 'videoMark', '无需标注')" @change="setPlatformSetting('weixinChannels', 'videoMark', ($event.target as HTMLSelectElement).value)"><option>无需标注</option><option>含AI生成内容</option><option>内容为虚构剧情，仅供娱乐</option><option>个人观点，仅供参考</option><option>内容包含营销广告</option></select></label>

              <template v-else-if="activePlatformTab === 'zhihu'">
                <label class="field"><span>视频标记</span><select :value="settingValue('zhihu', 'declaration', '内容无需标注')" @change="setPlatformSetting('zhihu', 'declaration', ($event.target as HTMLSelectElement).value)"><option>内容无需标注</option><option>含 AI 生成内容</option><option>含虚构演绎内容</option><option>内容含营销信息</option><option>内容为转载</option><option>个人观点仅供参考</option></select></label>
                <label class="field"><span>所属领域</span><select :value="settingValue('zhihu', 'domain', '')" @change="setPlatformSetting('zhihu', 'domain', ($event.target as HTMLSelectElement).value)"><option value="">不设置</option><option v-for="domain in zhihuDomains" :key="domain" :value="domain">{{ domain }}</option></select></label>
              </template>
            </div>
          </section>

          <div v-if="busy && uploadProgress" class="upload-state"><span>上传中 {{ uploadProgress }}%</span><div><i :style="{ width: `${uploadProgress}%` }" /></div></div>
          <p v-if="notice" class="notice">{{ notice }}</p>
          <button class="submit-button" type="submit" :disabled="submitDisabled">
            <LoaderCircle v-if="busy" class="spin" :size="18" /><Upload v-else :size="18" />{{ publishMode === 'auto_submit' ? '提交并自动发布' : '提交并填充' }}
          </button>
        </form>

        <aside class="job-panel">
          <div class="panel-title"><h2>最近任务</h2><span>{{ jobs.length }}</span></div>
          <div v-if="!jobs.length" class="empty-state">暂无任务</div>
          <article v-for="job in jobs" :key="job.jobId" class="job-row">
            <div><strong>{{ job.title }}</strong><span>{{ new Date(job.createdAt).toLocaleString('zh-CN') }} · {{ job.publishMode === 'auto_submit' ? '自动发布' : '仅填充' }}</span></div>
            <span class="status" :data-status="job.status">{{ statusLabel(job.status) }}</span>
            <p v-if="job.error">{{ job.error }}</p>
          </article>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.remote-publish {
  min-height: 100vh;
  background: #f5f6f8;
  color: #0f172a;
  font-family: Inter, "PingFang SC", sans-serif;
  letter-spacing: 0;
}

.remote-publish,
.remote-publish * { box-sizing: border-box; }
.remote-publish button { transition: transform 140ms cubic-bezier(.23, 1, .32, 1), border-color 140ms ease, background-color 140ms ease, color 140ms ease; }
.remote-publish button:active:not(:disabled) { transform: scale(.97); }
.boot-state { min-height: 100vh; display: grid; place-items: center; }
.visually-hidden { display: none; }

.login-shell { width: 100%; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; max-width: 420px; margin: auto; padding: 28px 22px; }
.login-brand, .header-brand { display: flex; align-items: center; gap: 10px; }
.login-brand img, .header-brand img { width: 30px; height: 30px; }
.login-brand strong { font-size: 18px; color: #020617; }
.login-form { align-self: center; display: grid; gap: 14px; min-width: 0; }
.login-form h1 { font-size: 28px; margin: 0 0 12px; color: #020617; }
.login-form label, .field > span { font-size: 13px; font-weight: 700; color: #334155; }
.login-form input, .field input, .field textarea, .field select, .date-input {
  width: 100%; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px;
  padding: 11px 12px; font: inherit; outline: none;
}
.login-form input::placeholder, .field input::placeholder, .field textarea::placeholder { color: #64748b; opacity: 1; }
.login-form input:focus, .field input:focus, .field textarea:focus, .field select:focus, .date-input:focus { border-color: #f43f5e; box-shadow: 0 0 0 3px #ffe4e6; }
.login-form button, .submit-button { border: 0; border-radius: 6px; background: #f43f5e; color: #fff; min-height: 44px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; }
.login-form button:hover:not(:disabled), .submit-button:hover:not(:disabled) { background: #e11d48; }
.login-form button:disabled, .submit-button:disabled { opacity: .48; cursor: not-allowed; }
.form-error, .notice { font-size: 13px; color: #b91c1c; margin: 0; }

.publish-header { height: 62px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 max(18px, calc((100vw - 1180px) / 2)); position: sticky; top: 0; z-index: 5; }
.header-brand span { font-weight: 800; color: #020617; }
.header-brand strong { font-size: 13px; color: #475569; border-left: 1px solid #e2e8f0; padding-left: 10px; }
.header-actions { display: flex; gap: 6px; }
.icon-button { width: 38px; height: 38px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; display: grid; place-items: center; color: #334155; }
.icon-button:hover { border-color: #fda4af; color: #e11d48; background: #fff1f2; }

.quota-band { max-width: 1180px; margin: auto; padding: 20px 18px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; }
.quota-band > div:not(.quota-track) { display: flex; justify-content: space-between; font-size: 13px; }
.quota-band span { color: #475569; }
.quota-band strong { color: #0f172a; }
.quota-track { grid-column: 1 / -1; height: 5px; background: #e2e8f0; overflow: hidden; }
.quota-track i, .upload-state i { display: block; height: 100%; background: #f43f5e; }

.channel-band { max-width: 1144px; margin: 0 auto 20px; padding: 12px 14px; border: 1px solid #e2e8f0; background: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.channel-status { display: flex; align-items: center; gap: 10px; min-width: 0; }
.channel-icon { width: 34px; height: 34px; border-radius: 6px; background: #f1f5f9; color: #475569; display: grid; place-items: center; }
.channel-status > div { display: grid; gap: 2px; }
.channel-status > div span { font-size: 11px; color: #64748b; }
.channel-status > div strong { font-size: 13px; }
.channel-status small { min-width: 0; font-size: 12px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-band[data-state="connected"] .channel-icon { color: #1d4ed8; background: #eff6ff; }
.channel-band[data-state="connected"] .channel-status strong { color: #1d4ed8; }
.channel-band[data-state="failed"] .channel-icon, .channel-band[data-state="failed"] .channel-status strong { color: #b91c1c; }
.secondary-button { min-height: 36px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.secondary-button:hover:not(:disabled) { border-color: #fda4af; color: #be123c; background: #fff1f2; }

.publish-layout { max-width: 1180px; margin: auto; padding: 0 18px 48px; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 34px; }
.publish-form { min-width: 0; display: grid; gap: 18px; }
.type-control { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid #cbd5e1; }
.type-control button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 12px; display: flex; gap: 7px; align-items: center; justify-content: center; font-weight: 700; color: #475569; }
.type-control button.active { color: #e11d48; border-bottom-color: #f43f5e; }

.media-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(250px, .65fr); gap: 14px; align-items: start; }
.tool-section, .form-section { min-width: 0; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; padding: 16px; }
.tool-header { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tool-header h2, .form-section h2, .platform-picker legend { margin: 0; font-size: 14px; font-weight: 800; color: #0f172a; }
.text-button { border: 0; background: transparent; color: #e11d48; font-size: 12px; font-weight: 700; padding: 5px; display: flex; align-items: center; gap: 5px; }
.upload-zone { width: 100%; min-height: 260px; border: 2px dashed #cbd5e1; border-radius: 6px; background: #f8fafc; color: #0f172a; display: grid; place-content: center; justify-items: center; gap: 8px; }
.upload-zone:hover { border-color: #fb7185; background: #fff1f2; }
.upload-zone small { color: #64748b; }
.upload-icon { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; background: #ffe4e6; color: #e11d48; }
.video-player { display: grid; place-items: center; overflow: hidden; border-radius: 6px; background: #0f172a; }
.video-player video { display: block; width: 100%; min-height: 260px; max-height: 520px; object-fit: contain; }
.file-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; font-size: 12px; }
.file-meta strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta span { color: #64748b; white-space: nowrap; }
.image-preview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.image-preview-grid article { position: relative; aspect-ratio: 1; overflow: hidden; border-radius: 6px; background: #f1f5f9; }
.image-preview-grid img { display: block; width: 100%; height: 100%; object-fit: cover; }
.image-preview-grid article button { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; display: grid; place-items: center; }

.cover-header { align-items: flex-start; }
.ratio-control { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.ratio-control button { border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; color: #64748b; padding: 4px 6px; font-size: 10px; font-weight: 700; }
.ratio-control button.active { border-color: #f43f5e; background: #fff1f2; color: #be123c; }
.cover-stage { width: 100%; min-height: 300px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; display: grid; place-items: center; }
.cover-stage:hover { border-color: #fda4af; }
.cover-frame { display: block; position: relative; overflow: hidden; border-radius: 6px; background: #0f172a; box-shadow: 0 1px 2px #0f172a1a; }
.cover-frame.ratio-4-3 { width: min(100%, 330px); aspect-ratio: 4 / 3; }
.cover-frame.ratio-3-4 { width: min(100%, 220px); aspect-ratio: 3 / 4; }
.cover-frame.ratio-9-16 { width: min(100%, 168px); aspect-ratio: 9 / 16; }
.cover-frame.ratio-16-9 { width: min(100%, 360px); aspect-ratio: 16 / 9; }
.cover-frame img, .cover-frame video { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-empty { position: absolute; inset: 0; color: #94a3b8; display: grid; place-content: center; justify-items: center; gap: 8px; font-size: 12px; font-weight: 700; }
.cover-footer { min-height: 30px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; }
.cover-footer > span { min-width: 0; color: #64748b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.form-section { display: grid; gap: 14px; }
.field-grid { display: grid; gap: 14px; }
.field { display: grid; gap: 7px; }
.field > span { display: flex; justify-content: space-between; gap: 12px; }
.field > span small { color: #64748b; font-weight: 500; }
.field textarea { resize: vertical; line-height: 1.6; }
.platform-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.platform-picker legend { width: 100%; margin-bottom: 2px; }
.platform-picker label input { position: absolute; opacity: 0; }
.platform-picker label span { display: flex; align-items: center; gap: 5px; border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 5px; padding: 8px 10px; font-size: 13px; }
.platform-picker svg { opacity: 0; }
.platform-picker input:focus-visible + span { outline: 2px solid #f43f5e; outline-offset: 2px; }
.platform-picker input:checked + span { border-color: #fb7185; color: #be123c; background: #fff1f2; }
.platform-picker input:checked + span svg { opacity: 1; }

.publish-settings { gap: 0; }
.publish-settings > h2 { margin-bottom: 14px; }
.setting-row, .check-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid #f1f5f9; }
.setting-row > div:first-child, .check-row > span { display: grid; gap: 3px; }
.setting-row strong, .check-row strong { font-size: 13px; color: #334155; }
.setting-row small, .check-row small { font-size: 11px; color: #64748b; }
.setting-action { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.date-input { max-width: 230px; padding: 8px 10px; font-size: 12px; }
.switch-control { position: relative; display: inline-flex; cursor: pointer; }
.switch-control input { position: absolute; opacity: 0; }
.switch-control span { width: 36px; height: 20px; border-radius: 10px; background: #cbd5e1; position: relative; transition: background-color 150ms ease; }
.switch-control span::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 150ms cubic-bezier(.23, 1, .32, 1); }
.switch-control input:checked + span { background: #f43f5e; }
.switch-control input:checked + span::after { transform: translateX(16px); }
.setting-block { display: grid; gap: 9px; padding: 12px 0; border-top: 1px solid #f1f5f9; }
.setting-block > span { font-size: 12px; font-weight: 700; color: #334155; }
.publish-mode-setting { padding-top: 0; border-top: 0; }
.mode-control { width: min(100%, 360px); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid #cbd5e1; border-radius: 5px; overflow: hidden; }
.mode-control button { min-height: 36px; border: 0; border-right: 1px solid #cbd5e1; background: #fff; color: #475569; font-size: 12px; font-weight: 700; }
.mode-control button:last-child { border-right: 0; }
.mode-control button.active { background: #fff1f2; color: #be123c; box-shadow: inset 0 0 0 1px #fb7185; }
.setting-hint { color: #64748b; font-size: 11px; line-height: 1.5; }
.visibility-control { display: flex; flex-wrap: wrap; gap: 6px; }
.visibility-control button, .platform-tabs button { border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; color: #475569; padding: 7px 9px; font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 5px; }
.visibility-control button.active, .platform-tabs button.active { border-color: #f43f5e; background: #fff1f2; color: #be123c; }
.check-row { justify-content: flex-start; cursor: pointer; }
.check-row input { width: 16px; height: 16px; margin: 0; accent-color: #f43f5e; flex: 0 0 auto; }

.platform-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.platform-fields { display: grid; gap: 12px; padding-top: 14px; border-top: 1px solid #f1f5f9; }
.platform-fields .check-row { padding: 4px 0; border: 0; }
.upload-state { font-size: 12px; color: #334155; }
.upload-state > div { height: 5px; background: #e2e8f0; margin-top: 7px; }
.notice { color: #1d4ed8; }
.submit-button { justify-self: start; padding: 0 22px; }

.job-panel { border-left: 1px solid #e2e8f0; padding-left: 26px; }
.panel-title { display: flex; align-items: center; justify-content: space-between; padding: 10px 0 14px; border-bottom: 1px solid #e2e8f0; }
.panel-title h2 { font-size: 16px; margin: 0; color: #020617; }
.panel-title span { font-size: 12px; color: #475569; }
.job-row { padding: 15px 0; border-bottom: 1px solid #e2e8f0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.job-row > div { display: grid; gap: 5px; min-width: 0; }
.job-row strong { font-size: 14px; color: #0f172a; overflow-wrap: anywhere; }
.job-row div span, .empty-state { font-size: 12px; color: #64748b; }
.job-row p { grid-column: 1 / -1; color: #b91c1c; font-size: 12px; margin: 0; }
.status { font-size: 12px; color: #475569; white-space: nowrap; }
.status[data-status="completed"] { color: #1d4ed8; }
.status[data-status="failed"] { color: #b91c1c; }
.status[data-status="running"] { color: #e11d48; }
.empty-state { padding: 28px 0; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .publish-layout { grid-template-columns: 1fr; }
  .job-panel { border-left: 0; border-top: 1px solid #e2e8f0; padding: 20px 0 0; }
}

@media (max-width: 680px) {
  .publish-header { padding: 0 16px; }
  .quota-band { grid-template-columns: 1fr; padding-inline: 16px; }
  .quota-track { grid-column: auto; }
  .channel-band { margin-inline: 16px; align-items: flex-start; }
  .channel-status { align-items: flex-start; flex-wrap: wrap; }
  .channel-status small { width: 100%; padding-left: 44px; white-space: normal; }
  .publish-layout { padding-inline: 16px; }
  .media-grid { grid-template-columns: 1fr; }
  .upload-zone { min-height: 210px; }
  .video-player video { min-height: 220px; max-height: 62vh; }
  .cover-stage { min-height: 280px; }
  .setting-row { align-items: flex-start; }
  .setting-action { align-items: flex-end; flex-direction: column-reverse; }
  .date-input { max-width: 190px; }
  .header-brand strong { display: none; }
}
</style>
