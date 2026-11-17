/**
 * The records production-agents.spec.ts serves.
 */
import { IN_VSCODE, openPlanFor } from '../openSessionFixtures.ts'
import { blockedWorkItem } from '../planningFixtures.ts'
import { backendRoutes } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

export const LONG_LABEL =
  'Проверить экспорт и журналы на утечку метки при параллельных запусках субагентов'

export const agent = (index: number, overrides = {}) => ({
  agent_id: `agent${String(index).padStart(11, '0')}`,
  session_id: '6f1c2a8e-0000-4000-8000-000000000001',
  agent_type: 'general-purpose',
  label: index === 0 ? LONG_LABEL : '',
  started_at: '2026-08-13T08:00:00Z',
  last_activity_at: '2026-08-13T08:29:00Z',
  ended_at: null,
  steps: [],
  link: 'claim',
  coordinator_items: 19,
  ...overrides,
})

const placed = { agent: null, family: 'claude' }
export const LIVE_PARENT = {
  ...placed,
  session: IN_VSCODE,
  state: 'live',
  opened_in: 'ide',
  opened_host: 'vscode',
}
/** A parent the fixtures' plan does not name, which it answers as a desktop app's session. */
export const ENDED_PARENT = {
  ...placed,
  session: '77777777-0000-4000-8000-000000000002',
  state: 'ended',
  opened_in: 'app',
  opened_host: 'claude-desktop',
}
export const NO_PARENT = {
  session: null,
  agent: null,
  family: '',
  state: 'none',
  opened_in: '',
  opened_host: '',
}

/** Rows in the order the read gives them, each under the parent named at its place. */
export const rowsOf = (...parents: object[]) =>
  parents.map((executor, index) => agent(index, { executor, label: `Agent number ${index}` }))

/** Three agents of one live parent: two the claim names, with their counts, and one exact. */
export const underOneParent = () => [
  agent(0, { executor: LIVE_PARENT, coordinator_items: 13 }),
  agent(1, { executor: LIVE_PARENT, coordinator_items: 19 }),
  agent(2, { executor: LIVE_PARENT, link: 'exact', coordinator_items: null }),
]
/** More agents than the tab's first screen holds. */
export const twentySeven = () => Array.from({ length: 27 }, (_, index) => agent(index))

const listed = (name: string, agents: object[]) =>
  backendRoutes(name, { agents: () => agents, openPlan: openPlanFor })

export const routes: DrivenRoutes[] = [
  listed('twentySeven()', twentySeven()),
  backendRoutes('twentySeven() closed', {
    agents: twentySeven,
    closedWith: 'The export carries no label.',
  }),
  listed('rowsOf(LIVE, LIVE, LIVE)', rowsOf(LIVE_PARENT, LIVE_PARENT, LIVE_PARENT)),
  listed('rowsOf(ENDED, LIVE, ENDED)', rowsOf(ENDED_PARENT, LIVE_PARENT, ENDED_PARENT)),
  listed('rowsOf(LIVE)', rowsOf(LIVE_PARENT)),
  listed('agent(0) without a parent', [agent(0, { executor: NO_PARENT })]),
  listed('underOneParent()', underOneParent()),
  listed('agent(0)', [agent(0)]),
  listed('agent(0) naming an item', [agent(0, { label: `See ${blockedWorkItem.reference}` })]),
]
