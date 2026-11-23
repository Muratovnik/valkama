/**
 * The server's Volumes read as a test double: `GET /api/planning/volumes` answered with made-up
 * figures, built row by row so a test writes out every figure it checks. A goal's row is written
 * whole by the test, its spending and its counts with it; nothing here adds anything up, so a
 * test that says a goal's figures equal the sums of its rows says so of numbers it wrote itself.
 *
 * Each read's query is kept, so a test can say what the page asked.
 */
import { vi } from 'vitest'

import { validateGoalVolumesAnswer, validateVolumesAnswer } from '@/shared/api/volumesApi.ts'

const CATEGORIES = [
  'triage',
  'deferred',
  'ready',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
] as const
type Category = (typeof CATEGORIES)[number]

/** The made-up store every double's space stands in. */
export const VOLUMES_STORE = '00000000-0000-4000-8000-0000000000aa'
const SINCE = '2026-03-01T09:00:00Z'

/** Tokens a spend counts: `anew` of them as input, nothing cached. */
const tokens = (anew: number | null) => ({
  input: anew,
  cached_read: anew === null ? null : 0,
  cache_write_5m: anew === null ? null : 0,
  cache_write_1h: anew === null ? null : 0,
  output: anew === null ? null : 0,
  reasoning: anew === null ? null : 0,
})

/** What a goal's items spent: `seconds` of agent time and `anew` tokens; `partly` begun before. */
export function spentOf(seconds: number, anew: number | null, partly = 0) {
  return {
    agent_seconds: seconds,
    tokens: tokens(anew),
    estimated_api_cost_usd: anew === null ? null : anew / 1_000_000,
    unpriced_tokens: 0,
    quality: anew === null ? null : ('observed' as const),
    partly_measured: partly,
  }
}

/** Every category at zero, with `counts` over it. */
function byCategory(counts: Partial<Record<Category, number>> = {}) {
  return Object.fromEntries(CATEGORIES.map((category) => [category, counts[category] ?? 0]))
}

let rowNumber = 0
const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`

/** A goal's or stage's row, as the read writes it; the contract validates it in the answer. */
export type GoalRow = Readonly<Record<string, unknown>>

export interface GoalRowInput {
  reference: string
  baseline?: number | null
  /** Why the row gives no count at acceptance; with it `baseline` is ignored. */
  baselineAbsent?: 'filtered' | 'migrated' | 'not_accepted' | 'not_started' | 'partial' | null
  /** The rows of the stages under it, as `goalRow` writes them. */
  children?: GoalRow[]
  closed?: number
  /** The work item id of a card the test already has; a made-up one otherwise. */
  id?: string
  kind?: 'goal' | 'stage'
  parent?: string | null
  remaining?: {
    anew: number
    basis: number
    estimated: number
    seconds: number
    unestimated: number
  } | null
  spent?: ReturnType<typeof spentOf>
  spentWithCancelled?: ReturnType<typeof spentOf>
  title?: string
  total?: number
}

/** A goal's or stage's row as the read writes it, every figure the one the test names. */
export function goalRow(input: GoalRowInput): GoalRow {
  rowNumber += 1
  const total = input.total ?? 0
  const closed = input.closed ?? 0
  const absent = input.baselineAbsent ?? (input.baseline === null ? 'not_accepted' : null)
  const left = input.remaining
  return {
    work_item_id: input.id ?? uuid(1000 + rowNumber),
    reference: input.reference,
    title: input.title ?? `Work of ${input.reference}`,
    kind: input.kind ?? ('goal' as const),
    state: null,
    container_state: 'in_progress' as const,
    open: true,
    parent_reference: input.parent ?? null,
    other_space: null,
    partial: false,
    tasks: {
      total,
      closed,
      completed: closed,
      cancelled: 0,
      by_category: byCategory({ active: total - closed, completed: closed }),
    },
    baseline: absent
      ? null
      : { tasks: input.baseline ?? total, basis: 'accepted', taken_at: SINCE },
    baseline_absent: absent,
    spent: input.spent ?? spentOf(0, null),
    spent_with_cancelled: input.spentWithCancelled ?? input.spent ?? spentOf(0, null),
    sessions: 0,
    commits: 0,
    commits_unknown_repository: 0,
    remaining:
      left === null || left === undefined
        ? null
        : {
            agent_seconds: left.seconds,
            tokens: tokens(left.anew),
            estimated_api_cost_usd: left.anew / 1_000_000,
            basis: left.basis,
            estimated: left.estimated,
            unestimated: left.unestimated,
          },
    children: input.children ?? [],
  }
}

/** A category's line of the numbers: its tasks, goals and stages, and its oldest card. */
function categoryLine(category: Category, tasks: number, filtered: boolean) {
  const open = category !== 'completed' && category !== 'cancelled'
  return {
    category,
    tasks,
    goals: filtered ? null : 0,
    stages: filtered ? null : 0,
    oldest:
      open && tasks > 0
        ? {
            work_item_id: uuid(1),
            reference: `MAIN-${CATEGORIES.indexOf(category) + 1}`,
            since: SINCE,
          }
        : null,
  }
}

export interface VolumesInput {
  /** Whether a store attached beside the read's holds work; none by default. */
  attachedWork?: boolean
  /** Tasks in each category; none by default. */
  categories?: Partial<Record<Category, number>>
  /** The filter the read was asked for; null for all work. */
  filter?: { kinds: ('bug' | 'improvement' | 'task')[]; labels: string[] } | null
  goals?: GoalRow[]
  /** When usage was first counted; null for a store that never counted any. */
  measuredFrom?: string | null
  /**
   * Outside goals: tasks by project id (null for none) and by label, each row's `tasks` in Ready
   * or its count in each category (`categories`).
   */
  outside?: {
    byLabel?: (OutsideCounts & { label: string | null })[]
    byProject?: (OutsideCounts & { project: string | null; name?: string })[]
  }
  /** The spaces of other stores the read could not read, each with its reason; none by default. */
  skipped?: { reason: string; space_ref: { data_scope_id: string; space_key: string } }[]
  /** The space read; null for every space. */
  space?: string | null
  /** Commits on no card; null where their list cannot be read. */
  unattached?: number | null
  /** Questions waiting for the owner. */
  waiting?: number
}

/** A row's tasks outside goals: `tasks` in Ready, or a count in each category. */
type OutsideCounts =
  | { tasks: number; categories?: never }
  | { categories: Partial<Record<Category, number>>; tasks?: never }

const outsideCategories = (row: OutsideCounts) => byCategory(row.categories ?? { ready: row.tasks })

/** The answer of `GET /api/planning/volumes`, validated as the page validates it. */
export function volumesAnswer(input: VolumesInput = {}) {
  const filtered = Boolean(input.filter)
  const space = input.space === undefined ? 'MAIN' : input.space
  const byProject = input.outside?.byProject ?? []
  const answer = {
    interface_version: 'valkama-planning-api',
    volumes: {
      scope:
        space === null
          ? { kind: 'global', space_ref: null, project_ref: null }
          : {
              kind: 'space',
              space_ref: { data_scope_id: VOLUMES_STORE, space_key: space },
              project_ref: null,
            },
      period: {
        from: '2030-03-04T00:00:00+03:00',
        to: '2030-03-11T00:00:00+03:00',
        utc_offset: 180,
      },
      filter: input.filter ?? null,
      measured_from: input.measuredFrom === undefined ? SINCE : input.measuredFrom,
      coverage: [
        {
          space_ref: { data_scope_id: VOLUMES_STORE, space_key: space ?? 'MAIN' },
          status: 'searched',
          reason: null,
        },
        ...(input.skipped ?? []).map((source) => ({ ...source, status: 'unavailable' })),
      ],
      attached_work: input.attachedWork ?? false,
      counts: {
        categories: CATEGORIES.map((category) =>
          categoryLine(category, input.categories?.[category] ?? 0, filtered),
        ),
        waiting_owner: {
          count: input.waiting ?? 0,
          oldest: input.waiting ? { request_id: uuid(2), reference: 'MAIN-1', since: SINCE } : null,
        },
        unattached_commits: input.unattached === undefined ? 0 : input.unattached,
      },
      goals: input.goals ?? [],
      outside: {
        tasks: byProject.reduce(
          (sum, row) =>
            sum + Object.values(outsideCategories(row)).reduce((all, count) => all + count, 0),
          0,
        ),
        by_project: byProject.map((row) => ({
          project: {
            id: row.project,
            unknown: false,
            name: row.project === null ? null : (row.name ?? row.project),
            combinations: null,
          },
          categories: outsideCategories(row),
        })),
        by_label: (input.outside?.byLabel ?? []).map((row) => ({
          label: row.label,
          categories: outsideCategories(row),
        })),
      },
      flow: {
        days: [
          { day: '2030-03-09', created: 2, closed: 1, decisions: 1, commits: 0 },
          { day: '2030-03-10', created: 1, closed: 2, decisions: 0, commits: 3 },
        ],
        totals: { created: 3, closed: 3, decisions: 1, commits: 3 },
        pace: {
          open: 4,
          recent: { days: 7, created: 3, closed: 3, trend: 'steady' },
          series: [],
        },
      },
      estimates: { min_basis: 5, basis: 0, rows: [] },
    },
  }
  validateVolumesAnswer(answer)
  return answer
}

/** A double of the read: each query kept, each answered by `answer`. */
export function volumesDouble(answer: (query: URLSearchParams) => object) {
  const asked: URLSearchParams[] = []
  return {
    asked,
    read(query: URLSearchParams) {
      asked.push(query)
      return answer(query)
    },
  }
}

/** The answer of `GET /api/planning/goal-volumes` for these rows, without their children. */
export function goalVolumesAnswer(rows: readonly GoalRow[]) {
  const answer = {
    interface_version: 'valkama-planning-api',
    goals: rows.map(({ children: _children, ...row }) => row),
  }
  validateGoalVolumesAnswer(answer)
  return answer
}

/**
 * `GET /api/planning/goal-volumes` over these rows: each id asked is answered with the row of that
 * work item id or reference. Any other address is not this read's: `answer` gives `null` for it.
 * Each read's ids are kept.
 */
export function goalVolumesDouble(rows: readonly GoalRow[]) {
  const asked: string[][] = []
  return {
    asked,
    answer(url: URL) {
      if (url.pathname !== '/api/planning/goal-volumes') return null
      const ids = url.searchParams.getAll('id')
      asked.push(ids)
      return goalVolumesAnswer(
        ids.flatMap((id) => rows.filter((row) => row.work_item_id === id || row.reference === id)),
      )
    },
  }
}

/**
 * The double as `fetch`, the reads it was asked returned. A request to any other address goes on
 * to the `fetch` it replaced, so a read the test did not mean to make is refused there.
 */
export function serveGoalVolumes(rows: readonly GoalRow[]) {
  const double = goalVolumesDouble(rows)
  const before = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const address = input instanceof Request ? input.url : input
      const answer = double.answer(new URL(address, 'http://valkama.test'))
      return answer ? new Response(JSON.stringify(answer)) : before(input, init)
    }),
  )
  return double.asked
}
