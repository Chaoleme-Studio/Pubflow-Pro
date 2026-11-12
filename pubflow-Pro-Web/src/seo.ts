import { useHead } from '@unhead/vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const rawSiteUrl = import.meta.env.VITE_PUBFLOW_SITE_URL || 'https://www.pubflow.chaoleme.cn';
export const siteUrl = rawSiteUrl.replace(/\/+$/, '');

const HOME_TITLE = 'PubFlow - 多平台短视频批量发布工具';
const HOME_DESCRIPTION = 'PubFlow 是面向短视频创作者和内容团队的多平台批量发布工具，支持集中编排素材、账号、标题、封面与发布队列。';

const pageSeo: Record<string, { title: string; description: string }> = {
  home: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  buy: {
    title: '购买 PubFlow - 套餐与激活码',
    description: '选择 PubFlow 套餐并完成支付。',
  },
  downloads: {
    title: '下载 PubFlow 浏览器插件',
    description: '下载 PubFlow Chrome 浏览器插件。',
  },
  license: {
    title: 'PubFlow 卡密自助服务',
    description: '查询 PubFlow 授权状态并管理已激活设备。',
  },
  admin: {
    title: 'PubFlow 管理后台',
    description: 'PubFlow 内部管理后台。',
  },
  'publish-remote': {
    title: 'PubFlow 远程发布',
    description: '通过已授权的 PubFlow 插件提交远程发布任务。',
  },
  'not-found-static': {
    title: '页面不存在 - PubFlow',
    description: '请返回 PubFlow 首页。',
  },
  'not-found': {
    title: '页面不存在 - PubFlow',
    description: '请返回 PubFlow 首页。',
  },
};

const softwareApplicationJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PubFlow',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Chrome and Chromium-based browsers',
  description: HOME_DESCRIPTION,
  url: `${siteUrl}/`,
});

export function useSiteSeo() {
  const route = useRoute();
  const routeName = computed(() => typeof route.name === 'string' ? route.name : 'not-found');
  const current = computed(() => pageSeo[routeName.value] || pageSeo['not-found']);
  const isHome = computed(() => routeName.value === 'home');

  useHead(() => ({
    title: current.value.title,
    htmlAttrs: { lang: 'zh-CN' },
    link: isHome.value
      ? [{ rel: 'canonical', href: `${siteUrl}/` }]
      : [],
    meta: [
      { name: 'description', content: current.value.description },
      {
        name: 'robots',
        content: isHome.value
          ? 'index,follow,max-image-preview:large'
          : 'noindex,nofollow,noarchive',
      },
      { property: 'og:locale', content: 'zh_CN' },
      { property: 'og:site_name', content: 'PubFlow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: current.value.title },
      { property: 'og:description', content: current.value.description },
      ...(isHome.value ? [{ property: 'og:url', content: `${siteUrl}/` }] : []),
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: current.value.title },
      { name: 'twitter:description', content: current.value.description },
    ],
    script: isHome.value
      ? [{ type: 'application/ld+json', innerHTML: softwareApplicationJsonLd }]
      : [],
  }));
}
