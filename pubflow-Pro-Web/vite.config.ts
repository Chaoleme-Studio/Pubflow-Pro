import { defineConfig, loadEnv, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(ROOT_DIR, '..');

function seoAssets(siteUrl: string): Plugin {
  return {
    name: 'pubflow-seo-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          'User-agent: *',
          'Allow: /',
          `Sitemap: ${siteUrl}/sitemap.xml`,
          '',
        ].join('\n'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          '  <url>',
          `    <loc>${siteUrl}/</loc>`,
          '  </url>',
          '</urlset>',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WORKSPACE_DIR, '');
  const apiProxyTarget = env.VITE_PUBFLOW_API_BASE_URL
    || env.PUBLIC_API_BASE_URL
    || env.PUBFLOW_LICENSE_API_BASE_URL
    || 'http://127.0.0.1:5189';
  const siteUrl = (env.VITE_PUBFLOW_SITE_URL
    || env.PUBFLOW_OFFICIAL_SITE_URL
    || 'http://117.72.147.216:5188').replace(/\/+$/, '');
  const webPort = Number(env.WEB_DEV_SERVER_PORT || '5188') || 5188;

  return {
    plugins: [tailwindcss(), vue(), seoAssets(siteUrl)],
    envDir: WORKSPACE_DIR,
    define: {
      // Web 始终走同源 /v1，开发时由 Vite proxy、生产时由 Nginx 反代。
      'import.meta.env.VITE_PUBFLOW_API_BASE_URL': JSON.stringify(''),
      'import.meta.env.VITE_PUBFLOW_SITE_URL': JSON.stringify(siteUrl),
    },
    ssgOptions: {
      dirStyle: 'nested',
      includedRoutes: () => ['/', '/buy', '/downloads', '/license', '/admin', '/404'],
    },
    server: {
      port: webPort,
      proxy: {
        '/v1': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/download-files': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/download-files/, '/static/downloads'),
        },
      },
    },
    preview: {
      port: webPort,
    },
  };
});
