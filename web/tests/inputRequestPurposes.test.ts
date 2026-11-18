/**
 * A question of every purpose the server asks, and one about a write that waits for the
 * owner with its `action` part, read through the list and the card's own reads.
 *
 * The strict reader once knew three purposes and no `action`: the first question about an
 * agent's goal refused the whole list and the card's discussion with it. The records follow
 * the server's answer for each point (a goal's and a cancel's question carry the cancel
 * list, a shared cancel what each session answered, a condition its steps, a close its
 * summary, a put-off its condition), and a purpose or a key it does not send is refused.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchInputRequest, fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'

import { requestEntry, requestList } from './support/inputRequests.ts'
import { present } from './support/present.ts'
import { withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

function serve(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(withSecurityBootstrap(async () => new Response(JSON.stringify(payload)))),
  )
}

/** Every purpose the server's store holds, in its order. */
const PURPOSES = [
  'review',
  'confirm',
  'return',
  'goal',
  'task',
  'cancel',
  'condition',
  'consent',
  'triage',
] as const

const asked = '2026-11-16T15:12:00Z'
const holder = 'claude (session session-a)'
const id = (index: number) => `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`

function question(
  index: number,
  purpose: string | null,
  action?: unknown,
): Record<string, unknown> {
  const entry = requestEntry()
  return {
    ...entry,
    request: { ...entry.request, request_id: id(index), purpose, ...(action ? { action } : {}) },
  }
}

const cancelList = {
  cancels: [
    {
      reference: 'TASK-8',
      title: 'Wire the reader',
      kind: 'task',
      state: { key: 'dev', name: 'Dev', category: 'active' },
      container_state: null,
      holder: ['codex (session session-b)'],
    },
    {
      reference: 'TASK-9',
      title: 'A stage under it',
      kind: 'stage',
      state: null,
      container_state: 'active',
      holder: [],
    },
  ],
  dependents: [
    { reference: 'TASK-12', title: 'Waits on it', kind: 'task', waits_on: 'TASK-8', how: 'blocks' },
    { reference: 'TASK-13', title: 'Put off', kind: 'task', waits_on: 'TASK-7', how: 'deferred' },
  ],
  // A list's token is sixteen hex digits; its value means nothing here.
  list_token: '0'.repeat(16),
}

const action = (point: string, extra: Record<string, unknown> = {}) => ({
  id: id(900),
  point,
  asked_by: holder,
  asked_at: asked,
  reason: null,
  proposed: {},
  outcome: null,
  ...extra,
})

/** One question about each kind of waiting write, as the server reads it whole. */
const ACTIONS: [string, ReturnType<typeof action>][] = [
  ['goal', action('proposed_goal', { cancel_list: cancelList })],
  ['task', action('task_in_goal')],
  [
    'cancel',
    action('cancel_shared', {
      reason: 'superseded by TASK-40',
      proposed: { state: 'cancelled' },
      cancel_list: cancelList,
      consent: [
        { session: 'codex (session session-b)', answer: 'object', reason: 'Mine.', at: asked },
        { session: 'claude (session session-c)', answer: null, reason: null, at: null },
      ],
    }),
  ],
  ['cancel', action('cancel_outside', { proposed: { state: 'cancelled' }, outcome: 'dropped' })],
  [
    'condition',
    action('condition', {
      reason: 'the step is done elsewhere',
      proposed: {
        removed: [{ id: 'step-1', text: 'Write the guide' }],
        rewritten: [{ id: 'step-2', from: 'Ship it', to: 'Ship it on Friday' }],
      },
    }),
  ],
  ['consent', action('cancel_shared', { proposed: { state: 'cancelled' }, consent: [] })],
  [
    'confirm',
    action('goal_close', { proposed: { summary: { done: 'Checked.', next: 'Nothing.' } } }),
  ],
  ['confirm', action('goal_close', { proposed: { summary: {} }, outcome: 'declined' })],
  [
    'goal',
    action('goal_defer', { reason: 'after the release', proposed: { until: '2026-12-01' } }),
  ],
  ['goal', action('proposed_goal', { asked_by: 'Valkama', outcome: 'carried_out' })],
]

describe('a question with a purpose', () => {
  it('reads in a list page whatever its purpose, and with none', async () => {
    const items = [null, ...PURPOSES].map((purpose, index) => question(index, purpose))
    serve(requestList(items as unknown as InputRequestEntry[]))
    const read = await fetchInputRequests({ target: requestEntry().target, status: 'all' })
    expect(read.items.map((entry) => entry.request.purpose)).toEqual([null, ...PURPOSES])
  })

  it('is refused for a purpose the server does not ask', () => {
    const detail = { interface_version: 'valkama-planning-requests', ...question(1, 'approve') }
    expect(() => validateInputRequestDetail(detail)).toThrow()
  })
})

describe('a question about a write that waits for the owner', () => {
  it('reads with its action in a list page', async () => {
    const items = ACTIONS.map(([purpose, part], index) => question(index, purpose, part))
    serve(requestList(items as unknown as InputRequestEntry[]))
    const read = await fetchInputRequests({ target: requestEntry().target, status: 'all' })
    expect(read.items.map((entry) => entry.request.action)).toEqual(ACTIONS.map(([, part]) => part))
  })

  it("reads with its action as the card's question detail", async () => {
    const [purpose, part] = present(ACTIONS[2], 'a shared cancel')
    const entry = question(7, purpose, part) as unknown as InputRequestEntry
    serve({ interface_version: 'valkama-planning-requests', ...entry })
    const read = await fetchInputRequest(entry.target, entry.request.request_id)
    expect(read.request.action).toEqual(part)
    expect(read.request.action?.consent?.map((row) => row.answer)).toEqual(['object', null])
  })

  it('is refused with a part the server does not send', () => {
    const cases = [
      action('proposed_goal', { asked_for: holder }),
      action('accept'),
      action('goal_close', { proposed: { summary: { done: 'Checked.' } } }),
      action('cancel_shared', { outcome: 'answered' }),
      action('cancel_shared', { cancel_list: { ...cancelList, extra: [] } }),
    ]
    for (const part of cases) {
      const detail = {
        interface_version: 'valkama-planning-requests',
        ...question(3, 'goal', part),
      }
      expect(() => validateInputRequestDetail(detail), JSON.stringify(part)).toThrow()
    }
  })
})
