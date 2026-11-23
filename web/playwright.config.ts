import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import { appBuild, appPort, harnessPort, runResults } from './tests/browser/browserRun.ts'
import { clipboardIgnore } from './tests/browser/clipboardSpecs.ts'
import { python, serverStore, storeEnvironment } from './tests/browser/serverStore.ts'
import { timedProject, timedTitle } from './tests/browser/timedChecks.ts'

// Every path below is absolute and every server starts in `web/`, because Playwright
// resolves a relative one against the configuration that is loaded, and the probe's
// (`tests/browser/probe.config.ts`) is this one loaded from elsewhere.
const web = fileURLToPath(new URL('.', import.meta.url))
const specs = join(web, 'tests/browser')
const outputDir = join(web, runResults)

// Two runs on one machine can go at once only on different ports, so
// VALKAMA_BROWSER_PORT moves the harness there and the built app to the next port.
const harness = `http://127.0.0.1:${harnessPort}`
const app = `http://127.0.0.1:${appPort}`
const vite = 'node node_modules/vite/bin/vite.js'
// The mocked app is built into this run's own ignored directory rather than the tracked
// `dist/`, and without the type check: `npm run typecheck` is the gate for types, and a
// spec's type error here only read as a server that would not start.
const appBundle = `${vite} build --outDir ${appBuild}`
// The build writes its errors to standard output, which Playwright drops by default.
const appServer = {
  url: `${app}/`,
  cwd: web,
  stdout: 'pipe',
  reuseExistingServer: false,
  timeout: 180_000,
} as const

// With VALKAMA_BROWSER_STORE named, only the `server-` specs run, against the real
// server on the app's port with that store; every other spec answers from mocked
// routes and runs only without it.
const store = serverStore()

// The specs that write the system clipboard are not selected unless VALKAMA_BROWSER_CLIPBOARD
// is `1`: not by a bare run, not by naming one, not by `--list`. Every project inherits this.
const testIgnore = clipboardIgnore(process.env)

// Every production spec but the Russian one, which runs in its own locale: a list of names
// skipped each spec nobody added to it.
const production = /(?:^|[\\/])production-(?!locale\.)[a-z0-9-]+\.spec\.ts$/
const inEnglish = { ...devices['Desktop Chrome'], baseURL: app, locale: 'en-US' }

export default store
  ? defineConfig({
      testDir: specs,
      testIgnore,
      outputDir,
      // Before the first spec: this run's directory of kept files (`keptShots.ts`).
      globalSetup: join(specs, 'keptShots.setup.ts'),
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
        // The real server serves the tracked `dist/` and no other directory, so this
        // branch still runs the release build there.
        command: `npm run build && "${python}" ../valkama.py serve --port ${appPort}`,
        env: storeEnvironment(store),
      },
    })
  : defineConfig({
      testDir: specs,
      testIgnore,
      outputDir,
      // Before the first spec: this run's directory of kept files (`keptShots.ts`), and the
      // app port serving the bundle this run has just built.
      globalSetup: [join(specs, 'keptShots.setup.ts'), join(specs, 'servedApp.setup.ts')],
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
          teardown: timedProject,
          use: { ...devices['Desktop Chrome'], baseURL: harness },
        },
        {
          name: 'production',
          testMatch: production,
          // Its tests that bound a time run in the project below.
          grepInvert: timedTitle,
          teardown: timedProject,
          use: inEnglish,
        },
        {
          name: 'production-ru',
          testMatch: /(?:^|[\\/])production-locale\.spec\.ts$/,
          teardown: timedProject,
          use: {
            ...devices['Desktop Chrome'],
            baseURL: app,
            locale: 'ru-RU',
          },
        },
        {
          // The tests of the production specs that bound a time (`timedChecks.ts`), once every
          // project above has ended, whatever it ended in, as a teardown is run, and one at a
          // time: the other workers are the heaviest work beside a test.
          name: timedProject,
          testMatch: production,
          grep: timedTitle,
          workers: 1,
          use: inEnglish,
        },
      ],
      webServer: [
        {
          command: `${vite} --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${harnessPort} --strictPort`,
          url: `${harness}/tests/browser/harness.html`,
          cwd: web,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          ...appServer,
          command: `${appBundle} && ${vite} preview --config tests/browser/vite.config.ts --outDir ${appBuild} --host 127.0.0.1 --port ${appPort} --strictPort`,
        },
      ],
    })
