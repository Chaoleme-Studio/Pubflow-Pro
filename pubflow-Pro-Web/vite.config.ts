import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(ROOT_DIR, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WORKSPACE_DIR, '');
  const apiProxyTarget = env.VITE_PUBFLOW_API_BASE_URL
    || env.PUBLIC_API_BASE_URL
    || env.PUBFLOW_LICENSE_API_BASE_URL
    || 'http://127.0.0.1:5189';
  const webPort = Number(env.WEB_DEV_SERVER_PORT || '5188') || 5188;

  return {
    plugins: [tailwindcss(), vue()],
    envDir: WORKSPACE_DIR,
    define: {
      'import.meta.env.VITE_PUBFLOW_API_BASE_URL': JSON.stringify(apiProxyTarget),
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
