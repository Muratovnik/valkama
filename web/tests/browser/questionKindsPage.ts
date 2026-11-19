/**
 * «Needs my answer» with a question of every kind: a choice of options and one question per
 * purpose the owner answers, each with the fields the server asks it with and the part of
 * `action` its kind's content reads.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { spaceRef } from './planningFixtures.ts'
import { asked, question } from './questionBackend.ts'
import { openQuestion } from './questionPage.ts'

type Request = InputRequestEntry['request']
type Purpose = NonNullable<Request['purpose']>

const answerField = (...options: string[]): InputRequestField => ({
  id: 'answer',
  label: 'Answer',
  type: 'choice',
  required: true,
  options: options.map((id) => ({ id, label: `Server ${id}` })),
})
const underField = (id: string, option: string, required: boolean): InputRequestField => ({
  id,
  label: id,
  type: 'text',
  required,
  options: [],
  under: { field: 'answer', option },
})
const until = underField('until', 'later', true)
const cancels = underField('cancels', 'drop', false)

/** The server's fields of each purpose (`request_model.py`). */
const FIELDS: Record<Purpose, InputRequestField[]> = {
  review: [answerField('accept', 'return')],
  confirm: [answerField('confirm', 'leave')],
  return: [answerField('do', 'later', 'drop'), until, cancels],
  goal: [answerField('do', 'later', 'drop'), until, cancels],
  task: [answerField('do', 'later', 'out', 'drop'), until],
  cancel: [answerField('cancel', 'keep'), underField('cancels', 'cancel', false)],
  condition: [answerField('allow', 'keep')],
  consent: [answerField('agree', 'object', 'moved_out')],
  triage: [answerField('do', 'later', 'drop'), until, cancels],
}

/** The write a question is about, as the server reads it out: only what each kind shows. */
function action(point: string, more: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999990',
    point,
    asked_by: 'claude (session 3c9e0000)',
    asked_at: '2026-10-24T09:00:00Z',
    reason: null,
    proposed: {},
    outcome: null,
    ...more,
  } as unknown as Request['action']
}

const ACTIONS: Partial<Record<Purpose, Request['action']>> = {
  condition: action('condition', {
    reason: 'The third channel left the goal.',
    proposed: {
      removed: [{ id: 's1', text: 'Sound is checked' }],
      rewritten: [{ id: 's2', from: 'Checked on three channels', to: 'Checked on two channels' }],
    },
  }),
  cancel: action('cancel_shared', {
    cancel_list: {
      cancels: [
        {
          reference: 'MAIN-301',
          title: 'Rail notice line',
          kind: 'task',
          state: { key: 'dev', name: 'Dev', category: 'active' },
          container_state: null,
          holder: ['codex (session 71aa0000)'],
        },
      ],
      dependents: [],
      list_token: 'token-1',
    },
    consent: [
      {
        session: 'codex (session 71aa0000)',
        answer: 'object',
        reason: 'Two thirds are done.',
        at: '2026-10-24T09:30:00Z',
      },
    ],
  }),
  triage: action('finding', {
    proposed: {
      conditions: ['Every switch says its state'],
      items: [
        { reference: 'MAIN-311', title: 'Focus leaves after saving' },
        { reference: 'MAIN-312', title: 'The hint reads too pale' },
      ],
      answer: 'do',
      why: 'Both block the settings window.',
    },
  }),
  confirm: action('goal_close', {
    proposed: { summary: { done: 'The adapter delivers to the tray.', next: '' } },
  }),
  goal: action('proposed_goal', {
    cancel_list: { cancels: [], dependents: [], list_token: 'token-2' },
  }),
}

let serial = 0
/** A question of a purpose, asked later than every one made before it. */
export function ofPurpose(purpose: Purpose | null, change: Partial<Request> = {}) {
  serial += 1
  const id = `88888888-8888-4888-8888-${String(serial).padStart(12, '0')}`
  const created = `2026-10-24T10:${String(serial).padStart(2, '0')}:00Z`
  if (purpose === null) return asked({ request_id: id, created_at: created, ...change })
  return question({
    request_id: id,
    created_at: created,
    prompt: `The ${purpose} question`,
    fields: FIELDS[purpose],
    purpose,
    ...(ACTIONS[purpose] ? { action: ACTIONS[purpose] } : {}),
    ...change,
  })
}

/** One question of every kind, the choice of options first. */
export const everyKind = () => [
  ofPurpose(null),
  ...(
    ['review', 'triage', 'goal', 'task', 'condition', 'cancel', 'confirm', 'return'] as const
  ).map((purpose) => ofPurpose(purpose)),
]

/** The list open over the board at a width, with the clock under the test's hand. */
export async function openKinds(page: Page, entries: InputRequestEntry[], width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.clock.install()
  const opened = await openQuestion(page, entries, () =>
    page.route('**/api/modules/planning/search?**', (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') ?? ''
      return route.fulfill({ json: searchAnswer(query) })
    }),
  )
  await page.keyboard.press('Escape')
  await expect(opened.drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^(?:Needs my answer|Ждут моего ответа)/u }).click()
  const dialog = page.getByRole('dialog', { name: /^(?:Needs my answer|Ждут моего ответа)$/u })
  const record = (prompt: string) => dialog.locator('.request-card').filter({ hasText: prompt })
  return { ...opened, dialog, record }
}

/** What the platform search finds for any words: an open card of the space and a closed one. */
function searchAnswer(query: string) {
  const found = (id: number, reference: string, title: string, open: boolean) => ({
    target: { space_ref: spaceRef, reference, writable: true },
    item: {
      work_item_id: `77777777-7777-4777-8777-${String(id).padStart(12, '0')}`,
      planning_space_id: '00000000-0000-4000-8000-000000000800',
      reference,
      title,
      state: { name: open ? 'Dev' : 'Done' },
      open,
      container_state: null,
      claim_ref: '',
    },
  })
  return {
    interface_version: 'valkama-planning-search',
    query,
    limit: 50,
    has_more: false,
    items: [
      found(1, 'MAIN-320', 'Tray delivery adapter', true),
      found(2, 'MAIN-321', 'A finished card', false),
    ],
    coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
  }
}
