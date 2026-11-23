/**
 * The task section the table specs read: sixteen tasks of long titles with work today and, for
 * most, the day before, as answers of the browser double (`served/analyticsTableFit.ts`, where the
 * served records live), and the addresses of its periods under the time and under the cost.
 * Rebuilt from made-up values.
 */
import { pageAt } from './analyticsPage.ts'

export { PARTLY_PRICED, TASKS } from './served/analyticsTableFit.ts'

export const PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today' }),
  week: pageAt({ by: 'work_item' }),
}

/** The same periods under the measure «cost», whose period before and change say the remark too. */
export const COST_PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today', measure: 'cost' }),
  week: pageAt({ by: 'work_item', measure: 'cost' }),
}
