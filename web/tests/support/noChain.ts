/**
 * The chain client for a spec about something else: every item answers an
 * empty chain, so the card holds no chain section and nothing reaches the
 * network. Vitest hoists `vi.mock` per file, so each spec that mounts the
 * inspector names this module in its own mock.
 */
import { vi } from 'vitest'

import { emptyChain } from '../fixtures/chain.ts'

export async function noChainModule() {
  const actual = await vi.importActual<typeof import('@/shared/api/planningChainApi.ts')>(
    '@/shared/api/planningChainApi.ts',
  )
  return {
    ...actual,
    fetchWorkItemChain: vi.fn(async (id: string) => emptyChain('QA-320', id)),
  }
}
