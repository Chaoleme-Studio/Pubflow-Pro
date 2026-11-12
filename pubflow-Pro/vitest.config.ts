import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/licensing/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
  define: {
    __PUBFLOW_DEV_WORKSPACE_PATH__: JSON.stringify(''),
    __PUBFLOW_DEFAULT_TOPIC_INTERVAL_MS__: JSON.stringify(800),
    __PUBFLOW_DEFAULT_AGENT_WS_URL__: JSON.stringify('ws://127.0.0.1:5190/v1/extension/ws'),
    __PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__: JSON.stringify(''),
    __PUBFLOW_OFFICIAL_SITE_URL__: JSON.stringify(''),
    __PUBFLOW_PROTOCOL_PUBLIC_KEY__: JSON.stringify(''),
    __PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI__: JSON.stringify(''),
    __PUBFLOW_LOCAL_MODE__: JSON.stringify(false),
  },
});
