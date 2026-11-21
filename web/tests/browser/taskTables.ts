import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
/**
 * The task section the table specs read: sixteen tasks of long titles with work today and, for
 * most, the day before, as answers of the browser double, and the addresses of its periods under
 * the time and under the cost. Rebuilt from made-up values.
 */
import { pageAt } from './analyticsPage.ts'

const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/**
 * Sixteen tasks of long titles, each with work today; how much each did yesterday varies. A task
 * `unpriced` names a count for has a price for only part of its tokens, today and the day before.
 */
function tasks(unpriced: (index: number) => number = () => 0): TimedStretch[] {
  return Array.from({ length: 16 }, (_, index) => {
    const group = {
      work_item: task(
        index + 1,
        `Read the planning documents through the board reader ${index + 1}`,
      ),
      account: ACCOUNT,
    }
    const left = unpriced(index)
    // Today: from an hour and seventeen minutes down to under a minute; tokens and a price, but
    // for the last four, which a client recorded no tokens for («Нет токенов», «Нет цены»). A
    // task that leaves tokens without a price costs a thousand dollars and more.
    const counted = index < 12
    const price = left ? 1100 : 7.56
    const today: TimedStretch = {
      at: new Date(2026, 10, 11, 9, index),
      group,
      spend: {
        seconds: counted ? (16 - index) * 290 : 30,
        tokens: counted ? 375_700 - index * 9000 : null,
        cost: counted ? price + index : null,
        unpriced: left,
      },
    }
    // Yesterday by the same hour: under a minute, one second (a change of thousands of percent),
    // a few minutes, or nothing at all («Nothing before»).
    const seconds = [30, 1, 300, 0][index % 4] ?? 0
    const spend = left
      ? { seconds, tokens: 50_000, cost: 500, unpriced: left / 2 }
      : { seconds, tokens: 0, cost: 0 }
    const before: TimedStretch[] = seconds
      ? [{ at: new Date(2026, 10, 10, 9, index), group, spend }]
      : []
    return [today, ...before]
  }).flat()
}

export const TASKS = tasks()

/**
 * The same tasks, of which the second, the sixth and the tenth leave 40 000 tokens without a
 * price today: their cost reads «≈ 1 109,00 $, 40 тыс. токенов без цены».
 */
export const PARTLY_PRICED = tasks((index) => (index < 12 && index % 4 === 1 ? 40_000 : 0))

export const PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today' }),
  week: pageAt({ by: 'work_item' }),
}

/** The same periods under the measure «cost», whose period before and change say the remark too. */
export const COST_PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today', measure: 'cost' }),
  week: pageAt({ by: 'work_item', measure: 'cost' }),
}
