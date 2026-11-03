import { defineConfig, devices } from '@playwright/test'

// Two checkouts on one machine can run this suite at once only on different ports, so
// VALKAMA_BROWSER_PORT moves the harness there and the built app to the next port.
const harnessPort = Number(process.env.VALKAMA_BROWSER_PORT ?? 4174)
const appPort = harnessPort + 1
const harness = `http://127.0.0.1:${harnessPort}`
const app = `http://127.0.0.1:${appPort}`

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
      testMatch: /ui-[a-z-]+\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: harness },
    },
    {
      name: 'production',
      // Every production spec but the Russian one, which runs in its own
      // locale below: a list of names skipped each spec nobody added to it.
      testMatch: /production-(?!locale\.)[a-z-]+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: app,
        locale: 'en-US',
      },
    },
    {
      name: 'production-ru',
      testMatch: /production-locale\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: app,
        locale: 'ru-RU',
      },
    },
  ],
  webServer: [
    {
      command: `node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${harnessPort} --strictPort`,
      url: `${harness}/tests/browser/harness.html`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run build && node node_modules/vite/bin/vite.js preview --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `${app}/`,
      // `vue-tsc` writes a type error to standard output, which Playwright drops by default.
      stdout: 'pipe',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
