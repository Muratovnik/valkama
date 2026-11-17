/**
 * How a chart of one whole split into parts is drawn: as a ring (`DonutChart`), which reads the
 * split at a glance, or as ranked bars (`RankedBars`), which compare the parts and list as many as
 * there are. A person switches between the two and the table (`ChartSection`); this file says
 * which one a chart opens on.
 */
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

/** The two drawings of one whole's split. */
export type SplitView = 'ring' | 'bars'

/**
 * The drawing a split opens on: a ring, except where its parts are as many as the tasks worked
 * on, which open on their ranked bars. A ring names four parts and folds every smaller one into
 * «the rest», and that rest is the reason: tasks are as many as the work done, so a ring of them
 * folds most of a week's time into one sector a reader cannot take apart, where the accounts,
 * projects, roles, models, efforts and environments fold little or nothing, and the executors and
 * launch classes well under half. The bars name every task in their order and leave the table the
 * ones past their list. `by` is the dimension the parts are values of; none for parts that are
 * not values of a dimension, the kinds of tokens.
 */
export function firstSplitView(by: UsageDimension | null): SplitView {
  return by === 'work_item' ? 'bars' : 'ring'
}
