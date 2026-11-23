/**
 * Pauses answers of `GET /api/analytics/pauses` with figures small enough to check by hand. The
 * buckets are the nine the CLI's report declares; `row` fills a row's tokens from its context and
 * what it read and wrote, and `PAUSES` holds three environments: a Claude subagent on a
 * subscription whose machine waits read 990 of 1,000 under four minutes and 10 of 1,000 at five
 * to six, so its sum reads half of 2,000; a Codex main session that read 300 of 400, whose
 * background work is not known; and a Claude main session's one person wait of an hour. No wake.
 */
import type { PauseRow, Pauses } from '@/shared/api/analyticsPausesApi.ts'

const EDGES: [string, number, number | null][] = [
  ['0-4m', 0, 240],
  ['4-5m', 240, 300],
  ['5-6m', 300, 360],
  ['6-30m', 360, 1800],
  ['30-60m', 1800, 3600],
  ['60-70m', 3600, 4200],
  ['70m-3h', 4200, 10_800],
  ['3-12h', 10_800, 43_200],
  ['12h+', 43_200, null],
]

interface RowGiven {
  bucket: string
  context: number
  read: number
  requests: number
  background?: [number, number] | null
  client?: PauseRow['client']
  cold?: number
  cost?: number
  role?: PauseRow['role']
  wait?: PauseRow['wait']
  written?: number
}

export function row(given: RowGiven): PauseRow {
  const written = given.written ?? 0
  const background = given.background === undefined ? [0, 0] : given.background
  return {
    client: given.client ?? 'claude',
    role: given.role ?? 'subagent',
    model: given.client === 'codex' ? 'gpt-5-codex' : 'claude-sonnet-4-5',
    auth: given.client === 'codex' ? null : 'subscription',
    wait: given.wait ?? 'machine',
    bucket: given.bucket,
    requests: given.requests,
    context_tokens: given.context,
    input_tokens: given.context - given.read - written,
    cached_read_tokens: given.read,
    cache_write_5m_tokens: written,
    cache_write_1h_tokens: 0,
    read_share: given.read / given.context,
    write_share: written / given.context,
    cold_requests: given.cold ?? 0,
    estimated_api_cost_usd: given.cost ?? 0,
    unpriced_requests: 0,
    background_known: background !== null,
    background_requests: background?.[0] ?? null,
    background_cold_requests: background?.[1] ?? null,
  }
}

export function pausesOf(rows: PauseRow[]): Pauses {
  return {
    interface_version: 'valkama-usage-pauses',
    from: '2026-11-04T00:00:00+00:00',
    to: '2026-11-11T15:00:00+00:00',
    buckets: EDGES.map(([key, from, to]) => ({ key, from_seconds: from, to_seconds: to })),
    waits: ['machine', 'person', 'wake'],
    cold_share: 0.5,
    runs: { read: 3, missing: 0 },
    rows,
  }
}

export const PAUSES = pausesOf([
  row({ bucket: '0-4m', requests: 10, context: 1000, read: 990, written: 10, cost: 0.5 }),
  row({
    bucket: '5-6m',
    requests: 4,
    context: 1000,
    read: 10,
    written: 990,
    cold: 4,
    cost: 1.25,
    background: [3, 1],
  }),
  row({
    client: 'codex',
    role: 'main',
    bucket: '0-4m',
    requests: 3,
    context: 400,
    read: 300,
    background: null,
  }),
  row({ role: 'main', wait: 'person', bucket: '60-70m', requests: 1, context: 1000, read: 100 }),
])

export const pausesAnswer = (pauses: Pauses) => ({
  interface_version: 'valkama-analytics-api',
  pauses,
})
