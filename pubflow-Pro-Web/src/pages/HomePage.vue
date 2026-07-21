<script setup lang="ts">
import { CloudUpload, Play, Sparkles } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { capabilityCards, platforms, showcaseRows } from '../config/marketing';

interface DanmakuItem {
  id: string;
  text: string;
  action: string;
  top: number;
  duration: number;
  delay: number;
}

const danmakuNames = [
  '小鱼短视频',
  '星辰传媒',
  '橘子工作室',
  '阿楠运营日记',
  '北岸内容组',
  '晴天剪辑',
  '青禾运营',
  '南巷工作室',
  '一页视频',
  '山海矩阵',
];

const danmakuActions = [
  () => `刚刚发布了 ${randomInt(6, 36)} 条视频`,
  () => `完成 ${randomInt(18, 96)} 条批量发布`,
  () => `同步了 ${randomInt(3, 8)} 个平台的发布队列`,
  () => `激活了 Pro ${Math.random() > 0.38 ? '年付' : '月付'}套餐`,
  () => `处理了 ${randomInt(12, 64)} 条素材任务`,
  () => `完成今日第 ${randomInt(2, 9)} 轮分发`,
];

const danmakuItems = ref<DanmakuItem[]>([]);

onMounted(() => {
  danmakuItems.value = Array.from({ length: 8 }, (_, index) => {
    const name = pick(danmakuNames);
    const action = pick(danmakuActions)();
    const minutes = randomInt(1, 18);
    return {
      id: `${name}-${index}-${minutes}`,
      text: `${name} ${action}`,
      action: `· ${minutes} 分钟前`,
      top: 8 + ((index * 17 + randomInt(0, 14)) % 84),
      duration: randomInt(16, 28),
      delay: index * 2.3 + randomInt(0, 12) / 10,
    };
  });
});

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}
</script>

<template>
  <main class="marketing-page">
    <div class="danmaku-layer" aria-hidden="true">
      <span
        v-for="item in danmakuItems"
        :key="item.id"
        class="danmaku-item"
        :style="{ top: `${item.top}px`, animationDuration: `${item.duration}s`, animationDelay: `${item.delay}s` }"
      >
        <span class="dmk-dot"></span>
        <span>{{ item.text }}</span>
        <span class="dmk-action">{{ item.action }}</span>
      </span>
    </div>
    <section class="hero-section">
      <div class="hero-backdrop">
        <div class="hero-bg"></div>
        <div class="hero-grid"></div>
        <div class="signal signal-a"></div>
        <div class="signal signal-b"></div>
        <div class="device-stage">
          <div class="glass-device">
            <div class="device-topbar">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div class="publish-orbit">
              <div v-for="item in platforms" :key="item.name" class="orbit-node" :class="`node-${item.tone}`">
                <strong>{{ item.name }}</strong>
                <span>{{ item.state }}</span>
              </div>
            </div>
            <div class="upload-core">
              <CloudUpload :size="42" />
              <strong>Publish Command Center</strong>
              <span>内容编排 / 平台分发 / 队列追踪</span>
            </div>
          </div>
        </div>
      </div>
      <div class="hero-copy">
        <div class="hero-badge">
          <span class="badge-dot"></span>
          多平台短视频自动上传浏览器插件
        </div>
        <h1>PubFlow</h1>
        <p class="hero-subtitle">为短视频团队和内容运营打造的发布中枢。把多平台、多账号、多素材的重复动作压缩成一次清晰的发布确认。</p>
        <div class="hero-actions">
          <RouterLink class="primary-button" to="/buy">
            <Play :size="18" />
            开始使用
          </RouterLink>
          <RouterLink class="secondary-button" to="/buy">
            <Sparkles :size="18" />
            查看套餐
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="capability-stage">
      <div class="section-kicker">产品能力</div>
      <h2>面向内容团队的发布工作台，不是给工程师看的流程图。</h2>
      <div class="capability-grid">
        <div v-for="item in capabilityCards" :key="item.title" class="capability-card">
          <span>{{ item.label }}</span>
          <strong>{{ item.stat }}</strong>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </div>
      </div>
    </section>

    <section class="product-showcase">
      <div class="showcase-copy">
        <div class="section-kicker">运营体验</div>
        <h2>复杂任务藏在背后，前台只保留运营真正要看的东西</h2>
        <p>素材、账号、平台、发布时间和结果状态放在同一个视图里，减少切换、复制和人工确认。</p>
      </div>
      <div class="product-console-preview">
        <div class="preview-top">
          <span>Campaign Queue</span>
          <strong>今日待发布 32 条</strong>
        </div>
        <div v-for="row in showcaseRows" :key="row.label" class="preview-row">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </div>
        <div class="preview-meter">
          <span style="--w: 72%"></span>
          <span style="--w: 48%"></span>
          <span style="--w: 86%"></span>
        </div>
      </div>
    </section>

    <section class="ability-band">
      <div>
        <span>个人创作者</span>
        <strong>轻量启动</strong>
      </div>
      <div>
        <span>工作室矩阵</span>
        <strong>批量运营</strong>
      </div>
      <div>
        <span>品牌内容组</span>
        <strong>稳定交付</strong>
      </div>
      <RouterLink class="primary-button" to="/buy">查看开通方式</RouterLink>
    </section>
  </main>
</template>
