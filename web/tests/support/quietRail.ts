/**
 * The rail's reads, asked of nothing: for a test of the page's own reads, which counts and orders
 * what the panel asks. Mocked in place of `useRailReads`, the rail's tiles stand at their first
 * read and ask nothing; `tests/components/analyticsRail.spec.ts` holds what the rail asks.
 */
import { shallowRef } from 'vue'

import type { useRailReads as realRailReads } from '@/pages/analytics/composables/useRailReads.ts'

export function useRailReads(): ReturnType<typeof realRailReads> {
  return { askedAt: shallowRef(new Date()), reads: shallowRef({}), refresh: async () => {} }
}
