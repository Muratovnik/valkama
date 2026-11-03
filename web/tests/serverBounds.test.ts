/**
 * A bound the web puts on a server answer is the server's own bound or none.
 *
 * Each case below is an answer the server can send — a list it never counts, a
 * text it caps looser, a field it always carries — at one past the bound the
 * web used to apply. A bound the server does not hold refuses a real card,
 * search or directory, so each must read.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateHistory } from '@/shared/api/executionModel.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import {
  readRefusal,
  validateReadModel,
  validateWorkItemRecord,
} from '@/shared/api/planningModel.ts'
import { validatePlatformContextPayload } from '@/shared/api/platformContextPayload.ts'
import { validatePlatformPlanningPayload } from '@/shared/api/platformPlanningPayload.ts'

import { executionHistory } from './browser/executionFixtures.ts'
import { boardId } from './fixtures/board.ts'
import { chainResponse, emptyChain } from './fixtures/chain.ts'
import { workItemFixture } from './fixtures/workItem.ts'
import { finderResponse } from './support/globalFinder.ts'
import { requestEntry, requestList } from './support/inputRequests.ts'
import { withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

const at = '2026-11-03T09:00:00Z'
const many = <T>(count: number, make: (index: number) => T) =>
  Array.from({ length: count }, (_, index) => make(index))
/** A name of the server's longest length, with the brackets the old patterns refused. */
const longName = `Release <beta> ${'n'.repeat(184)}`
const spaceRef = { data_scope_id: boardId(3), space_key: 'QA' }

function serve(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(withSecurityBootstrap(async () => new Response(JSON.stringify(payload)))),
  )
}

const link = (index: number) => ({
  kind: 'relates-to',
  direction: 'outgoing',
  work_item_id: boardId(index + 1),
  reference: `QA-${index + 1}`,
  title: 'Related',
})
const ref = (index: number) => ({
  kind: 'commit',
  value: `c${index}`,
  label: '',
  author: 'codex',
  at,
})
const agent = (index: number, id = `agent-${index}`) => ({
  agent_id: id,
  session_id: id,
  agent_type: id,
  label: '',
  started_at: null,
  last_activity_at: null,
  ended_at: null,
  steps: [],
  link: 'exact',
  coordinator_items: null,
})
const member = (index: number) => ({
  work_item_id: boardId(10_000 + index),
  reference: `QA-${index + 1}`,
  title: 'Member',
  state: { key: 'dev', name: 'Dev', category: 'active', is_terminal: false },
  claim_ref: '',
  claim_state: null,
  parent_reference: null,
  created_at: at,
  closed_at: null,
  ready: false,
  rank: index + 1,
})
const day = (index: number) => ({
  day: new Date(Date.UTC(2000, 0, 1 + index)).toISOString().slice(0, 10),
  created: 0,
  closed: 0,
  total: 0,
  closed_total: 0,
})
const named = (index: number, title = 'Project') => ({
  project_id: `project-${index}`,
  title,
  binding_state: 'unbound',
})
const project = (index: number, title?: string) => ({ ...named(index, title), planning_spaces: [] })
const space = (title: string, work_items: unknown[] = []) => ({
  space_ref: spaceRef,
  title,
  work_items,
})
const ready = (payload: unknown) => ({
  interface_version: 'valkama-ui-state',
  status: 'ready',
  payload,
})
const planning = (payload: unknown) => ({
  interface_version: 'valkama-planning',
  scope: { kind: 'global' },
  state: ready(payload),
})

describe('a card', () => {
  it.each([
    ['201 links', { links: many(201, link) }],
    ['201 refs', { refs: many(201, ref) }],
    ['5001 agents', { agents: many(5001, (index) => agent(index)) }],
    ['an agent whose ids run to 200 characters', { agents: [agent(0, 'a'.repeat(200))] }],
    ['33 warnings past 512 characters', { warnings: many(33, () => 'w'.repeat(600)) }],
  ])('reads with %s', (_, change) => {
    const record = { ...workItemFixture('Bounds', 1), ...change }
    expect(() => validateWorkItemRecord(record)).not.toThrow()
  })

  it('still refuses an agent id past its 200-character limit', () => {
    const record = { ...workItemFixture('Bounds', 1), agents: [agent(0, 'a'.repeat(201))] }
    expect(() => validateWorkItemRecord(record)).toThrow()
  })

  it('reads a refusal whose joined guard messages run past 1000 characters', () => {
    const message = many(8, (index) => `[guard${index}] ${'m'.repeat(200)}`).join('; ')
    expect(readRefusal({ error: { code: 'workflow_guard', message } })?.error.message).toBe(message)
  })

  it('reads a workflow with 65 states', () => {
    const states = many(65, (index) => ({
      state_id: boardId(1000 + index),
      key: `s${index}`,
      name: `State ${index}`,
      category: 'active',
      is_terminal: false,
      position: index,
    }))
    const model = {
      interface_version: 'valkama-planning-read-model',
      planning_spaces: [],
      planning_space: {
        planning_space_id: boardId(1),
        project_id: 'bounds',
        name: 'Bounds',
        key: 'QA',
        provider_kind: 'local',
      },
      workflow: {
        workflow_id: boardId(2),
        name: 'Wide',
        initial_state_id: states[0]?.state_id,
        states,
        transitions: many(4097, (index) => ({
          from: states[index % 65]?.state_id,
          to: states[(index + 1) % 65]?.state_id,
        })),
      },
      work_items: [],
      links: [],
      stale_claims: [],
    }
    expect(validateReadModel(model).workflow?.states).toHaveLength(65)
  })
})

describe('questions', () => {
  it('refuses a question without note, which the server always sends', () => {
    const entry = requestEntry()
    const request: Record<string, unknown> = { ...entry.request }
    delete request.note
    expect(() =>
      validateInputRequestDetail({ interface_version: 'valkama-planning-requests', ...entry }),
    ).not.toThrow()
    expect(() =>
      validateInputRequestDetail({
        interface_version: 'valkama-planning-requests',
        ...entry,
        request,
      }),
    ).toThrow()
  })

  it('reads a list whose coverage names 2001 sources', () => {
    const list = requestList()
    const source = list.coverage[0]
    expect(() =>
      validateInputRequestList({ ...list, coverage: many(2001, () => source) }),
    ).not.toThrow()
  })
})

it('reads a search whose coverage names 10001 sources', async () => {
  const answer = finderResponse()
  serve({ ...answer, coverage: many(10_001, () => answer.coverage[0]) })
  const found = await searchGlobalPlanningWorkItems('needle', new AbortController().signal)
  expect(found.coverage).toHaveLength(10_001)
})

it('reads a chain past every old list bound', async () => {
  const root = emptyChain()
  const chain = {
    ...root,
    total: 5001,
    open: 5001,
    origins: many(501, () => ({ parent_reference: null, parent_title: null, count: 1, open: 1 })),
    series: many(4001, day),
    members: many(5001, member),
    edges: many(20_001, (index) => ({
      from: root.root.work_item_id,
      to: boardId(10_000 + (index % 5001)),
      kind: 'discovered-from',
    })),
  }
  serve(chainResponse(chain as unknown as Parameters<typeof chainResponse>[0]))
  const read = await fetchWorkItemChain(root.root.work_item_id, 'chain')
  expect([read.origins.length, read.series.length, read.members.length, read.edges.length]).toEqual(
    [501, 4001, 5001, 20_001],
  )
})

describe('the project directory', () => {
  it.each([
    ['257 projects', { projects: many(257, (index) => project(index)), planning_spaces: [] }],
    ['1025 spaces', { projects: [project(0)], planning_spaces: many(1025, () => space('S')) }],
    [
      'a project and a space named as the server allows',
      { projects: [project(0, longName)], planning_spaces: [space(longName)] },
    ],
  ])('reads Planning with %s', (_, payload) => {
    expect(() => validatePlatformPlanningPayload(planning(payload))).not.toThrow()
  })

  it.each([
    ['257 projects', many(257, (index) => ({ ...named(index), resources: [] }))],
    ['a project named as the server allows', [{ ...named(0, longName), resources: [] }]],
  ])('reads the context with %s', (_, projects) => {
    const context = {
      interface_version: 'valkama-context',
      scope: { kind: 'global' },
      state: ready({
        primary: { data_scope_id: spaceRef.data_scope_id, is_writable: true },
        projects,
        ui_prefs: null,
      }),
    }
    expect(() => validatePlatformContextPayload(context)).not.toThrow()
  })
})

it('reads an execution linked to 51 sessions', () => {
  const [execution] = executionHistory.executions
  const session = {
    session_id: 's',
    relation: 'attached',
    status: 'idle',
    attention: '',
    client: 'claude',
  }
  const history = {
    ...executionHistory,
    executions: [{ ...execution, sessions: many(51, () => session) }],
  }
  expect(validateHistory(history).executions[0]?.sessions).toHaveLength(51)
})
