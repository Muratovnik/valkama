/**
 * The owner's Windows alerts, as the server keeps and checks them.
 *
 * A page never shows a toast: the process that wrote the event does, which is why
 * the settings live on the server and this module only reads and writes them. It
 * also says what the page has in focus, so the sender stays quiet about what is
 * already on the screen.
 */

import { parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

/** Sending a test may compile the helper first and then waits for Windows' answer. */
const TEST_DEADLINE_MS = 20_000
/** A presence report is worth nothing late, and must not hold a connection while it waits. */
const PRESENCE_DEADLINE_MS = 5000

export const ALERT_EVENTS = ['question', 'review', 'launchFailed'] as const
export const ALERT_CONTENTS = ['generic', 'title', 'prompt'] as const

class AlertsRequestError extends Error {
  readonly code: string
  readonly status: number | null
  /** The server's own words for a refusal, where it gave any. */
  readonly detail: string | null

  constructor(code: string, status: number | null, detail: string | null, message = code) {
    super(message)
    this.name = 'AlertsRequestError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

function invalid(path: string, detail: string): never {
  throw new AlertsRequestError('alerts_contract_invalid', null, null, `${path}: ${detail}`)
}

const settingsSchema = strictObject({
  enabled: z.boolean(),
  events: strictObject({
    question: z.boolean(),
    review: z.boolean(),
    launchFailed: z.boolean(),
  }),
  content: enumField(ALERT_CONTENTS),
  locale: enumField(['ru', 'en'] as const),
})

/** What Windows answered about Valkama's toasts, or why it could not be asked. */
const checkFields = {
  state: z.string().min(1).max(64),
  setting: z.number().int().nullable(),
  reason: z.string().max(4096).nullable(),
}
const checkSchema = strictObject(checkFields)

const statusSchema = strictObject({
  /** The Start menu shortcut with Valkama's identity: without it Windows drops a toast. */
  shortcut: z.boolean(),
  windows: checkSchema,
  /**
   * Facts for diagnostics, which this screen does not act on: a click goes through
   * the `valkama://` scheme, which starts the app, and `windows` already says when
   * the helper could not be built.
   */
  autostart: z.string().min(1).max(64),
  helper: z.boolean(),
})

/** A test toast: what Windows answered, and whether the helper was started on it. */
const trialSchema = strictObject({ ...checkFields, shown: z.boolean() })

export type AlertSettings = z.infer<typeof settingsSchema>
export type AlertEvent = keyof AlertSettings['events']
export type AlertCheck = z.infer<typeof checkSchema>
export type AlertStatus = z.infer<typeof statusSchema>
export type AlertTrial = z.infer<typeof trialSchema>

export interface AlertPresence {
  focused: boolean
  hub_open: boolean
  page_id: string
  work_item_id: string | null
}

/** Whichever words the server's refusal carries; the surfaces do not all answer alike. */
function refusalDetail(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { error, reason } = payload as { error?: unknown; reason?: unknown }
  if (typeof error === 'string') return error
  const message = (error as { message?: unknown } | null | undefined)?.message
  if (typeof message === 'string') return message
  return typeof reason === 'string' ? reason : null
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(url, init)
  if (!response.ok)
    throw new AlertsRequestError(
      'request_failed',
      response.status,
      refusalDetail(payload),
      `${response.status} ${url}`,
    )
  return payload
}

export async function fetchAlertSettings(): Promise<AlertSettings> {
  const payload = await request('/api/alerts/settings')
  return parseContract(settingsSchema, payload, 'alerts.settings', invalid)
}

/** The whole record goes every time: a key left out would be reset to its default. */
export async function saveAlertSettings(settings: AlertSettings): Promise<AlertSettings> {
  const payload = await request('/api/alerts/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return parseContract(settingsSchema, payload, 'alerts.settings', invalid)
}

export async function fetchAlertStatus(): Promise<AlertStatus> {
  const payload = await request('/api/alerts/status')
  return parseContract(statusSchema, payload, 'alerts.status', invalid)
}

export async function sendTestAlert(): Promise<AlertTrial> {
  const payload = await request('/api/alerts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(TEST_DEADLINE_MS),
  })
  return parseContract(trialSchema, payload, 'alerts.test', invalid)
}

/**
 * Report what this page has in focus. `keepalive` carries the report a closing page
 * sends last. The answer holds nothing the page uses, and a failure means no listener
 * is there to ask, which the sender reads the same way, so the caller may ignore both.
 */
export async function reportAlertPresence(presence: AlertPresence): Promise<void> {
  await secureFetch('/api/alerts/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(presence),
    keepalive: true,
    signal: AbortSignal.timeout(PRESENCE_DEADLINE_MS),
  })
}

/** The server's words for a refusal, or null where the failure is ours to word. */
export function alertRefusalDetail(error: unknown): string | null {
  return error instanceof AlertsRequestError ? error.detail : null
}
