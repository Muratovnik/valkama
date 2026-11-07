import { expect, test } from 'vitest'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { agentRowGroups } from '@/widgets/work-item-inspector/utils/agentUsage.ts'

import type { UsageAgent } from '@/shared/api/planningUsageApi.ts'

const SESSION = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'

// Printed to 8 characters, two sessions started within a minute read as one: every surface
// prints a session's first two groups.
test('a parent only the usage reads name prints its session as every surface does', () => {
  const run = { session_id: SESSION, agent_id: 'a5312a12985a391c2' } as UsageAgent
  const [group] = agentRowGroups([], [run])
  expect(group?.shortSession).toBe('019a2b3c-4d5e')
})

test("an agent's id keeps its own start, which no session's rule sets", () => {
  expect(agentIdStart('a5312a12985a391c2')).toBe('a5312a12')
})
