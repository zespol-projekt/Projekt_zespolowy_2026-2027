import { defineConfig } from '@playwright/test';

const port = process.env.MAP_TEST_PORT ?? '8091';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    channel: 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node node_modules/expo/bin/cli start --clear --web --port ${port}`,
    url: `http://localhost:${port}/stores`,
    // Always start with isolated credentials, never reuse a developer's real project.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', SMARTCART_E2E: '1',
      EXPO_PUBLIC_LEAFLETS_API_URL: 'https://smartcart-test.supabase.invalid/functions/v1/leaflets',
      EXPO_PUBLIC_SUPABASE_URL: 'https://smartcart-test.supabase.invalid',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser_test_only',
      EXPO_PUBLIC_STORES_API_URL: 'http://localhost:8787/v1/stores',
    },
  },
});
