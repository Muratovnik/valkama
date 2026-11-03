import type { Page, Route } from '@playwright/test'

export const ALERT_SETTINGS = {
  enabled: true,
  events: { question: true, review: true, launchFailed: false },
  content: 'title',
  locale: 'en',
}

const windows = (state: string, setting: number | null = null, reason: string | null = null) => ({
  state,
  setting,
  reason,
})

function status(shortcut: boolean, answer: ReturnType<typeof windows>) {
  return { shortcut, windows: answer, helper: true, autostart: 'disabled' }
}

const WINDOWS_ENABLED = windows('enabled', 0)
export const TRIAL_SHOWN = { ...WINDOWS_ENABLED, shown: true }
export const ALERT_STATUS_READY = status(true, WINDOWS_ENABLED)

/** One status per answer the readiness row can give, with the words it must say for it. */
export const READINESS_CASES = [
  { name: 'ready', status: ALERT_STATUS_READY, word: 'Ready' },
  {
    name: 'no-shortcut',
    status: status(false, WINDOWS_ENABLED),
    word: 'No Valkama shortcut',
  },
  {
    name: 'disabled-for-application',
    status: status(true, windows('disabled-for-application', 1)),
    word: 'Windows turned off Valkama notifications',
  },
  {
    name: 'disabled-for-user',
    status: status(true, windows('disabled-for-user', 2)),
    word: 'Windows turned off all notifications',
  },
  {
    name: 'disabled-by-group-policy',
    status: status(true, windows('disabled-by-group-policy', 3)),
    word: 'Notifications are off by policy',
  },
  {
    name: 'disabled-by-manifest',
    status: status(true, windows('disabled-by-manifest', 4)),
    word: 'Windows forbids notifications for this app',
  },
  {
    name: 'switched-off',
    status: status(false, windows('switched-off', null, 'VALKAMA_NO_ALERTS is set')),
    word: 'Off by an environment variable',
  },
  {
    name: 'unsupported',
    status: status(false, windows('unsupported', null, 'toasts are Windows-only')),
    word: 'Windows only',
  },
  {
    name: 'helper-unavailable',
    status: status(
      true,
      windows(
        'unavailable',
        null,
        'the C# compiler was not found at C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      ),
    ),
    word: 'The check failed',
  },
  {
    name: 'check-failed',
    status: status(true, windows('failed', null, 'Windows did not answer in time')),
    word: 'The check failed',
  },
] as const

type AlertsDouble = {
  /** An answer that stands for the whole `PUT`, instead of storing what was sent. */
  refuseWrite?: { body: unknown; status: number }
  settings?: unknown
  status?: unknown
  test?: unknown
}

const fulfill = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** The alerts endpoints with this test's answers; routed after the backend, so it wins. */
export async function installAlerts(page: Page, double: AlertsDouble = {}) {
  const writes: unknown[] = []
  let tests = 0
  let stored: unknown = double.settings ?? ALERT_SETTINGS
  await page.route('**/api/alerts/settings', async (route) => {
    if (route.request().method() !== 'PUT') return fulfill(route, stored)
    const body: unknown = route.request().postDataJSON()
    writes.push(body)
    if (double.refuseWrite)
      return fulfill(route, double.refuseWrite.body, double.refuseWrite.status)
    stored = body
    return fulfill(route, body)
  })
  await page.route('**/api/alerts/status', (route) =>
    fulfill(route, double.status ?? ALERT_STATUS_READY),
  )
  await page.route('**/api/alerts/test', (route) => {
    tests += 1
    return fulfill(route, double.test ?? TRIAL_SHOWN)
  })
  return { writes, testsSent: () => tests }
}
