import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'harness',
      testMatch: /ui-system\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
    },
    {
      name: 'production',
      testMatch: /production-(?:execution|memory|modules|semantic-states|settings|shell)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4175',
        locale: 'en-US',
      },
    },
    {
      name: 'production-ru',
      testMatch: /production-locale\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4175',
        locale: 'ru-RU',
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174/tests/browser/harness.html',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
