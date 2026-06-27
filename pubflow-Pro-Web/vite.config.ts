import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_PUBFLOW_API_BASE_URL || 'http://127.0.0.1:3001';

  return {
    plugins: [tailwindcss(), vue()],
    server: {
      port: 5188,
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
  };
});
