/**
 * Made-up rows of `GET /api/analytics/usage`, each set built for one case the rail and the table
 * must say right: the adviser, which spends tokens and no agent time; a model that ran only as
 * the adviser; an account that held nearly all of a day; and «now» while only a session's own
 * run worked.
 */
import type { UsageGroupValue, UsageRow } from '@/shared/api/analyticsApi.ts'

type Kinds = UsageRow['tokens']

const NO_TOKENS: Kinds = {
  input: null,
  cached_read: null,
  cache_write_5m: null,
  cache_write_1h: null,
  output: null,
  reasoning: null,
}

function row(
  group: Record<string, UsageGroupValue>,
  seconds: number,
  cost: number | null,
  tokens: Kinds = NO_TOKENS,
): UsageRow {
  return {
    group,
    agent_seconds: seconds,
    estimated_seconds: 0,
    quality: seconds > 0 ? 'observed' : null,
    tokens,
    estimated_api_cost_usd: cost,
    unpriced_tokens: 0,
  }
}

const known = (id: string): UsageGroupValue => ({ id, unknown: false })
const unplaced: UsageGroupValue = { id: null, unknown: true }

/** A period by role: the adviser spent $38.62 of tokens and no second of agent time. */
export const BY_ROLE: UsageRow[] = [
  row({ role: known('main') }, 46_712.385, 205.36917, {
    input: 6382,
    cached_read: 713_629_045,
    cache_write_5m: 48_219,
    cache_write_1h: 5_216_734,
    output: 3_640_518,
    reasoning: 1_107_356,
  }),
  row({ role: known('advisor') }, 0, 38.62471, {
    input: 3_918_627,
    cached_read: 0,
    cache_write_5m: 0,
    cache_write_1h: 0,
    output: 176_340,
    reasoning: null,
  }),
  row({ role: known('subagent') }, 30_158.642, 239.08154, {
    input: 21_407,
    cached_read: 486_310_552,
    cache_write_5m: 7_903_416,
    cache_write_1h: 0,
    output: 2_874_093,
    reasoning: 961_207,
  }),
]

/**
 * A period by role and model, in no order of size: model-elm ran only as the adviser, and two
 * pairs have a model nobody can place.
 */
export const BY_ROLE_AND_MODEL: UsageRow[] = [
  row({ role: known('main'), model: known('model-birch') }, 27_516.809, 121.73508),
  row({ role: known('advisor'), model: known('model-elm') }, 0, 11.95237),
  row({ role: known('subagent'), model: known('model-alder') }, 3407.152, 2.86019),
  row({ role: known('main'), model: known('model-cedar') }, 15_382.617, 64.90273),
  row({ role: known('subagent'), model: unplaced }, 512.736, null),
  row({ role: known('subagent'), model: known('model-cedar') }, 41_093.274, 231.58417),
  row({ role: known('advisor'), model: known('model-birch') }, 0, 27.41862),
  row({ role: known('main'), model: known('model-damson') }, 219.481, 0.74316),
  row({ role: known('main'), model: unplaced }, 38.905, null),
]

/** A day by account: one account held all but under a minute of the day's agent time. */
export const ACCOUNTS_OF_A_DAY: UsageRow[] = [
  row({ account: known('5d1e7a42-0000-4000-8000-00000000000b') }, 81_264.519, 402.66183),
  row({ account: unplaced }, 47.362, null),
  row({ account: known('93b0c6fe-0000-4000-8000-00000000000c') }, 2.715, null),
]

/** «Now» by launch class while only a session's own run worked: no launch, a value of its own. */
export const NOW_BY_LAUNCH: UsageRow[] = [
  row({ launch_class: { id: null, unknown: false } }, 2741.836, 8.53194),
]
