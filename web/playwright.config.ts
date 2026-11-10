import { defineConfig, devices } from '@playwright/test'

import { python, serverStore, storeEnvironment } from './tests/browser/serverStore.ts'

// Two checkouts on one machine can run this suite at once only on different ports, so
// VALKAMA_BROWSER_PORT moves the harness there and the built app to the next port.
const harnessPort = Number(process.env.VALKAMA_BROWSER_PORT ?? 4174)
const appPort = harnessPort + 1
const harness = `http://127.0.0.1:${harnessPort}`
const app = `http://127.0.0.1:${appPort}`
const build = 'npm run build'
// `vue-tsc` writes a type error to standard output, which Playwright drops by default.
const appServer = {
  url: `${app}/`,
  stdout: 'pipe',
  reuseExistingServer: false,
  timeout: 180_000,
} as const

// With VALKAMA_BROWSER_STORE named, only the `server-` specs run, against the real
// server on the app's port with that store; every other spec answers from mocked
// routes and runs only without it.
const store = serverStore()

export default store
  ? defineConfig({
      testDir: './tests/browser',
      fullyParallel: false,
      retries: 0,
      reporter: 'line',
      use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
      projects: [
        {
          name: 'server',
          testMatch: /(?:^|[\\/])server-[a-z0-9-]+\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], baseURL: app, locale: 'en-US' },
        },
      ],
      webServer: {
        ...appServer,
        command: `${build} && "${python}" ../valkama.py serve --port ${appPort}`,
        env: storeEnvironment(store),
      },
    })
  : defineConfig({
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
          // From the start of the file's name, and digits allowed: a name with one was skipped
          // without a word, and one merely containing `ui-` would have run here too.
          testMatch: /(?:^|[\\/])ui-[a-z0-9-]+\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], baseURL: harness },
        },
        {
          name: 'production',
          // Every production spec but the Russian one, which runs in its own
          // locale below: a list of names skipped each spec nobody added to it.
          testMatch: /(?:^|[\\/])production-(?!locale\.)[a-z0-9-]+\.spec\.ts$/,
          use: {
            ...devices['Desktop Chrome'],
            baseURL: app,
            locale: 'en-US',
          },
        },
        {
          name: 'production-ru',
          testMatch: /(?:^|[\\/])production-locale\.spec\.ts$/,
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
          ...appServer,
          command: `${build} && node node_modules/vite/bin/vite.js preview --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${appPort} --strictPort`,
        },
      ],
    })
