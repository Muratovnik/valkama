/**
 * The pauses answer as the section's tables: for one wait, a table per environment — the client,
 * the role, the model and the sign-in — with a line per bucket of the answer its requests fell
 * in, in the answer's order, and a line of their sum. A bucket none of its requests fell in has no
 * line: an environment of a few requests had most of its lines empty, and the section ran to four
 * thousand pixels of them. The sum's shares are of the sum's tokens, as each line's are of its own; a share with no tokens
 * is null.
 */
import type { PauseRow, Pauses, PauseWait } from '@/shared/api/analyticsPausesApi.ts'

/** The figures of a line: what its requests sent, read and cost. */
export interface PauseFigures {
  backgroundCold: number | null
  backgroundRequests: number | null
  cold: number
  cost: number
  readShare: number | null
  requests: number
  writeShare: number | null
}

interface PauseLine {
  bucket: string
  figures: PauseFigures
}

export interface PauseTable {
  auth: PauseRow['auth']
  backgroundKnown: boolean
  client: PauseRow['client']
  /** The environment's key, unique in the answer. */
  key: string
  lines: PauseLine[]
  model: string
  role: PauseRow['role']
  total: PauseFigures
}

const environmentKey = (row: PauseRow) =>
  JSON.stringify([row.client, row.role, row.model, row.auth])

/** The figures of rows taken together, their shares over their tokens together. */
function figuresOf(rows: readonly PauseRow[], backgroundKnown: boolean): PauseFigures {
  let context = 0
  let read = 0
  let written = 0
  const figures: PauseFigures = {
    requests: 0,
    cold: 0,
    cost: 0,
    readShare: null,
    writeShare: null,
    backgroundRequests: backgroundKnown ? 0 : null,
    backgroundCold: backgroundKnown ? 0 : null,
  }
  for (const row of rows) {
    context += row.context_tokens
    read += row.cached_read_tokens
    written += row.cache_write_5m_tokens + row.cache_write_1h_tokens
    figures.requests += row.requests
    figures.cold += row.cold_requests
    figures.cost += row.estimated_api_cost_usd
    if (backgroundKnown) {
      figures.backgroundRequests =
        (figures.backgroundRequests ?? 0) + (row.background_requests ?? 0)
      figures.backgroundCold = (figures.backgroundCold ?? 0) + (row.background_cold_requests ?? 0)
    }
  }
  if (context) {
    figures.readShare = read / context
    figures.writeShare = written / context
  }
  return figures
}

/** The tables of one wait, an environment each, in the answer's order; none without a request. */
export function pauseTables(pauses: Pauses, wait: PauseWait): PauseTable[] {
  const grouped = new Map<string, PauseRow[]>()
  for (const row of pauses.rows) {
    if (row.wait !== wait) continue
    const key = environmentKey(row)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return [...grouped].map(([key, rows]) => {
    const [first] = rows
    const backgroundKnown = first.background_known
    return {
      key,
      client: first.client,
      role: first.role,
      model: first.model,
      auth: first.auth,
      backgroundKnown,
      lines: pauses.buckets.flatMap(({ key: bucket }) => {
        const inBucket = rows.filter((row) => row.bucket === bucket)
        return inBucket.length ? [{ bucket, figures: figuresOf(inBucket, backgroundKnown) }] : []
      }),
      total: figuresOf(rows, backgroundKnown),
    }
  })
}
