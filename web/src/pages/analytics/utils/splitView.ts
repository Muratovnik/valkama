/**
 * How a chart of one whole split into parts is drawn, by how its parts are named.
 *
 * A breakdown whose values are named by identifiers — accounts, projects, roles, models, efforts,
 * environments, launch classes, the kinds of tokens — is drawn two ways: as a ring
 * (`DonutChart`), which reads the split at a glance and opens first, or as ranked bars
 * (`RankedBars`), which compare the parts; a person switches between them and the table
 * (`ChartSection`). Their names are a few words at most, seventeen characters at the longest
 * measured, which a ring's legend holds on one line beside its figure.
 *
 * A breakdown whose values are named by free text (`FREE_TEXT_DIMENSIONS`) is a list only: its
 * ranked bars, each name on a line of its own clamped to two, switched with the table alone.
 * Those names run to a sentence — a week's task titles measured 90 characters at the median and
 * 209 at the longest, the sessions' titles 36 and 67 — which no ring's legend holds beside its
 * figures: it broke them inside words, four lines an entry. And they are as many as the work
 * done, hundreds of tasks a week, which a ring of five named sectors folds into one rest no reader
 * can take apart. A section split by a second dimension is a list only when either side is free
 * text, and otherwise draws bars alone, since a ring of pairs would tell one value's pairs apart by
 * hue alone.
 */
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

/** The two drawings of one whole's split. */
export type SplitView = 'ring' | 'bars'

/** The dimensions whose values are named by free text, which are drawn as a list only. */
export const FREE_TEXT_DIMENSIONS: ReadonlySet<UsageDimension> = new Set(['work_item', 'executor'])

/**
 * Whether a breakdown by `by`, split by `across` where one is given, is named by free text on
 * either side and so drawn as a list only. `by` null is parts that are no values of a dimension,
 * the kinds of tokens.
 */
export const namedByText = (by: UsageDimension | null, across?: UsageDimension | null) =>
  [by, across].some((one) => one != null && FREE_TEXT_DIMENSIONS.has(one))
