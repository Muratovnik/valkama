/**
 * How much of the prompt cache model requests read after pauses of each length,
 * `GET /api/analytics/pauses`: the report `valkama usage pauses --json` prints, under `pauses`.
 * Its fields are described in `docs/guides/commands.md` ("usage pauses") and the read in
 * `docs/connection-contract.md` ("Pauses before model requests"). Strict like every contract
 * here: a field nobody declared is refused rather than drawn. A first read parses gigabytes of
 * transcripts, so the server answers 202 with how far it got (`PausesReading`) before the
 * browser's wait runs out, and the read asks again until the report comes.
 */

import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { enumField, invalid } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

/** What a pause waited on, in the answer's order: the machine, a person, or a keep-warm wake. */
export const PAUSE_WAITS = ['machine', 'person', 'wake'] as const
export type PauseWait = (typeof PAUSE_WAITS)[number]

const ROLES = ['main', 'subagent'] as const
const CLIENTS = ['claude', 'codex'] as const
const UTC_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/u
const NAME = /^[^\u{0}]{1,200}$/u
const BUCKET = /^[0-9a-z+-]{1,16}$/u

const share = () => z.number().min(0).max(1).nullable()
const count = () => positiveInt(true)

const rowSchema = strictObject({
  client: enumField(CLIENTS),
  role: enumField(ROLES),
  model: z.union([boundedText(NAME, 200), z.literal('')]),
  auth: z.literal('subscription').nullable(),
  wait: enumField(PAUSE_WAITS),
  bucket: boundedText(BUCKET, 16),
  requests: count(),
  context_tokens: count(),
  input_tokens: count(),
  cached_read_tokens: count(),
  cache_write_5m_tokens: count(),
  cache_write_1h_tokens: count(),
  read_share: share(),
  write_share: share(),
  cold_requests: count(),
  estimated_api_cost_usd: z.number().min(0),
  unpriced_requests: count(),
  background_known: z.boolean(),
  background_requests: count().nullable(),
  background_cold_requests: count().nullable(),
})

const pausesSchema = strictObject({
  interface_version: z.literal('valkama-usage-pauses', {
    message: 'expected valkama-usage-pauses',
  }),
  from: boundedText(UTC_MOMENT, 32),
  to: boundedText(UTC_MOMENT, 32),
  project: boundedText(NAME, 200).nullable(),
  buckets: z.array(
    strictObject({
      key: boundedText(BUCKET, 16),
      from_seconds: count(),
      to_seconds: count().nullable(),
    }),
  ),
  waits: z.array(enumField(PAUSE_WAITS)),
  cold_share: z.number().min(0).max(1),
  runs: strictObject({ read: count(), missing: count() }),
  rows: z.array(rowSchema),
})

const answerSchema = strictObject({
  interface_version: z.literal('valkama-analytics-api', {
    message: 'expected valkama-analytics-api',
  }),
  pauses: pausesSchema,
})

const readingSchema = strictObject({
  interface_version: z.literal('valkama-analytics-api', {
    message: 'expected valkama-analytics-api',
  }),
  reading: strictObject({ runs_read: count(), runs_left: count() }),
})

export type Pauses = z.infer<typeof pausesSchema>
/** How far a read the server has not finished got: the runs read, and those left. */
export type PausesReading = z.infer<typeof readingSchema>['reading']
export type PauseRow = z.infer<typeof rowSchema>

/** The pauses answer, or a refusal naming what does not fit the contract. */
export function validatePausesAnswer(payload: unknown): Pauses {
  return parseContract(answerSchema, payload, 'analytics.pauses', invalid).pauses
}

/**
 * The period the read is asked for, as the usage read takes one, and the project whose runs it
 * counts; none or null counts every run.
 */
export interface PausesQuery {
  from: string
  to: string
  utcOffset: number
  project?: string | null
}

/** How long the read waits before it asks again a server that is still reading. */
const PAUSES_ASK_AGAIN_MS = 300

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

/**
 * The report over the period. While the server answers that it is still reading, each answer
 * goes to `reading` and the read asks again; an abort ends it between two asks too.
 */
export async function fetchPauses(
  query: PausesQuery,
  signal?: AbortSignal,
  reading?: (progress: PausesReading) => void,
): Promise<Pauses> {
  const path = '/api/analytics/pauses'
  const parameters = new URLSearchParams({
    from: query.from,
    to: query.to,
    utc_offset: String(query.utcOffset),
  })
  if (query.project) parameters.set('project', query.project)
  for (;;) {
    const { response, payload } = await readJsonResponse(`${path}?${parameters}`, { signal })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    if (response.status !== 202) return validatePausesAnswer(payload)
    const progress = parseContract(readingSchema, payload, 'analytics.pauses', invalid).reading
    reading?.(progress)
    await pause(PAUSES_ASK_AGAIN_MS, signal)
  }
}
