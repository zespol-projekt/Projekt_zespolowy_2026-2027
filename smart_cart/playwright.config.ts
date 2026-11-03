import { defineConfig } from '@playwright/test';

const port = process.env.MAP_TEST_PORT ?? '8081';
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
    command: `npx expo start --web --port ${port}`,
    url: `http://localhost:${port}/stores`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
  },
});
