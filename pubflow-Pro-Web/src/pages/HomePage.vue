<script setup lang="ts">
import { CloudUpload, Play, Sparkles } from 'lucide-vue-next';
import { capabilityCards, platforms, showcaseRows } from '../config/marketing';

defineProps<{
  navigate: (href: string) => void;
}>();
</script>

<template>
  <main class="marketing-page">
    <div class="danmaku-layer" aria-hidden="true">
      <span class="danmaku-item" style="top: 8px; animation-duration: 18s; animation-delay: 0s;">
        <span class="dmk-dot"></span>
        <span>小鱼短视频 刚刚发布了 12 条视频</span>
        <span class="dmk-action">· 3 分钟前</span>
      </span>
      <span class="danmaku-item" style="top: 40px; animation-duration: 22s; animation-delay: 3s;">
        <span class="dmk-dot"></span>
        <span>星辰传媒 完成 48 条批量发布</span>
        <span class="dmk-action">· 5 分钟前</span>
      </span>
      <span class="danmaku-item" style="top: 72px; animation-duration: 16s; animation-delay: 6s;">
        <span class="dmk-dot"></span>
        <span>橘子工作室 使用 Selector 自动化发布</span>
        <span class="dmk-action">· 8 分钟前</span>
      </span>
      <span class="danmaku-item" style="top: 20px; animation-duration: 20s; animation-delay: 9s;">
        <span class="dmk-dot"></span>
        <span>阿楠运营日记 激活了 Pro 年付套餐</span>
        <span class="dmk-action">· 12 分钟前</span>
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
          <button class="primary-button" type="button" @click="navigate('/buy')">
            <Play :size="18" />
            开始使用
          </button>
          <button class="secondary-button" type="button" @click="navigate('/buy')">
            <Sparkles :size="18" />
            查看套餐
          </button>
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
        <h2>复杂任务藏在背后，前台只保留运营真正要看的东西。</h2>
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
      <button class="primary-button" type="button" @click="navigate('/buy')">查看开通方式</button>
    </section>
  </main>
</template>
