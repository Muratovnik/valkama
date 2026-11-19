/**
 * A list's host as the page is one: the list asks for an order and draws the one it is
 * given, so a test that sorts from a column header gives the order back, as the page's
 * address does.
 */
import type { VueWrapper } from '@vue/test-utils'

import type { ViewSort } from '@/widgets/work-item-views/utils/workOrder.ts'

/** Newest change first, the order these tests' rows were written for. */
const NEWEST_FIRST: ViewSort = { key: 'updated', descending: true }

export function keptOrder(start: ViewSort = NEWEST_FIRST) {
  let held: VueWrapper | undefined
  return {
    /** The props a list takes from its host: the order, and where it asks for another. */
    props: {
      sort: start,
      onSort: (next: ViewSort) => {
        void held?.setProps({ sort: next })
      },
    },
    /** The mounted list, which takes the orders it asks for from here on. */
    hold<Mounted extends VueWrapper>(wrapper: Mounted): Mounted {
      held = wrapper
      return wrapper
    },
  }
}
