import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { PlanningActivityEntry } from '@/shared/api/planningModel.ts'
import {
  activityToasts,
  filterInbox,
  MAX_TOASTS_PER_PUSH,
  sessionToasts,
  toDesktopToasts,
} from '@/shared/lib/notifications.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings.ts'
import type { AgentSession } from '@/shared/types/session.ts'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key

/**
 * One transition, as the feed reports it: the destination state and its
 * category. The Board era wrote "dev -> done" and the reader had to parse it,
 * which is why a renamed lane silently stopped notifying.
 */
function moved(
  id: number,
  state: string,
  category: string | null,
  number = 100 + id,
): PlanningActivityEntry {
  return {
    event_id: id,
    work_item_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    reference: `BEN-${number}`,
    title: `Item ${number}`,
    action: 'transitioned',
    detail: state,
    state_category: category,
    author: 'agent',
    at: '2026-08-07T10:00:00Z',
  }
}

function session(overrides: Partial<AgentSession>): AgentSession {
  return {
    id: 'sess-1',
    client: 'claude',
    cwd: 'C:/work/repo',
    label: '',
    work_item: null,
    status: 'active',
    attention: '',
    attention_seen: false,
    started_at: '2026-08-07T09:00:00Z',
    last_seen: '2026-08-07T10:00:00Z',
    ended_at: null,
    quiet_seconds: 0,
    current_step: '',
    ...overrides,
  }
}

test('the first activity payload sets the baseline and never replays history', () => {
  const items = [moved(9, 'done', 'completed'), moved(8, 'review', 'review')]
  const first = activityToasts(items, null, DEFAULT_SETTINGS, t)
  assert.equal(first.toasts.length, 0)
  assert.equal(first.baseline, 9)
})

test('an item reaching a completed, review or blocked state toasts once allowed', () => {
  const items = [
    moved(12, 'done', 'completed'),
    moved(11, 'review', 'review'),
    moved(10, 'dev', 'active'),
  ]
  const { toasts, baseline } = activityToasts(items, 9, DEFAULT_SETTINGS, t)
  assert.equal(baseline, 12)
  // Oldest first, and the plain dev move is not an owner event.
  assert.deepEqual(
    toasts.map((toast) => toast.key),
    ['activity-11', 'activity-12'],
  )
  assert.equal(toasts[1].workItem, 'BEN-112')
  assert.equal(toasts[1].planningSpace, 'BEN')
  assert.match(toasts[1].title, /notify\.itemCompleted/)
  assert.match(toasts[1].body, /Item 112/)

  const muted = mergeSettings({ notify: { itemInReview: false } })
  const filtered = activityToasts(items, 9, muted, t)
  assert.deepEqual(
    filtered.toasts.map((toast) => toast.key),
    ['activity-12'],
  )

  const off = mergeSettings({ notifyEnabled: false })
  assert.equal(activityToasts(items, 9, off, t).toasts.length, 0)
})

test('a flood of lifecycle events collapses into capped toasts plus a summary', () => {
  const items = Array.from({ length: 6 }, (_, index) => moved(20 + index, 'done', 'completed'))
  const { toasts } = activityToasts(items, 19, DEFAULT_SETTINGS, t)
  assert.equal(toasts.length, MAX_TOASTS_PER_PUSH + 1)
  assert.equal(toasts.at(-1)?.key, 'summary')
  assert.match(toasts.at(-1)?.body ?? '', /notify\.more.*"count":3/)
})

test('only an observed active-to-ended transition toasts, not pre-existing history', () => {
  const first = sessionToasts([session({ status: 'ended' })], null, DEFAULT_SETTINGS, t)
  assert.equal(first.toasts.length, 0)

  const live = sessionToasts([session({})], first.known, DEFAULT_SETTINGS, t)
  assert.equal(live.toasts.length, 0)

  const ended = sessionToasts(
    [session({ status: 'ended', attention: 'ended' })],
    live.known,
    DEFAULT_SETTINGS,
    t,
  )
  assert.equal(ended.toasts.length, 1)
  assert.equal(ended.toasts[0].event, 'sessionEnded')
  assert.match(ended.toasts[0].title, /claude/)

  // The same signature on the next push stays silent.
  const repeat = sessionToasts(
    [session({ status: 'ended', attention: 'ended' })],
    ended.known,
    DEFAULT_SETTINGS,
    t,
  )
  assert.equal(repeat.toasts.length, 0)
})

test('a failed session and a ringing agent map to their own events and settings', () => {
  const base = sessionToasts([session({})], null, DEFAULT_SETTINGS, t)
  const failed = sessionToasts(
    [session({ status: 'failed', attention: 'failed' })],
    base.known,
    DEFAULT_SETTINGS,
    t,
  )
  assert.equal(failed.toasts[0]?.event, 'sessionFailed')

  const ringingBase = sessionToasts([session({ id: 'sess-2' })], null, DEFAULT_SETTINGS, t)
  const blocked = sessionToasts(
    [session({ id: 'sess-2', attention: 'blocked' })],
    ringingBase.known,
    DEFAULT_SETTINGS,
    t,
  )
  assert.equal(blocked.toasts[0]?.event, 'agentBlocked')

  // Waiting is off by default; enabling it turns the same transition into a toast.
  const waiting = sessionToasts(
    [session({ id: 'sess-2', attention: 'waiting' })],
    blocked.known,
    DEFAULT_SETTINGS,
    t,
  )
  assert.equal(waiting.toasts.length, 0)
  const chatty = mergeSettings({ notify: { agentWaiting: true } })
  const waitingOn = sessionToasts(
    [session({ id: 'sess-2', attention: 'waiting' })],
    blocked.known,
    chatty,
    t,
  )
  assert.equal(waitingOn.toasts[0]?.event, 'agentWaiting')
})

test('the reported inbox for older shells obeys the same settings', () => {
  const inbox = [
    { attention: 'ended' },
    { attention: 'failed' },
    { attention: 'waiting' },
    { attention: 'blocked' },
  ]
  assert.deepEqual(
    filterInbox(inbox, DEFAULT_SETTINGS).map((item) => item.attention),
    ['ended', 'failed', 'blocked'],
  )
  assert.equal(filterInbox(inbox, mergeSettings({ notifyEnabled: false })).length, 0)
  const quiet = mergeSettings({ notify: { sessionEnded: false } })
  assert.deepEqual(
    filterInbox(inbox, quiet).map((item) => item.attention),
    ['failed', 'blocked'],
  )
})

test('desktop toasts carry the navigation payload under bridge field names', () => {
  const desktop = toDesktopToasts([
    {
      key: 'k',
      event: 'itemCompleted',
      title: 'T',
      body: 'B',
      planningSpace: 'BEN',
      workItem: 'BEN-5',
    },
  ])
  assert.deepEqual(desktop, [
    { key: 'k', title: 'T', body: 'B', planning_space: 'BEN', work_item: 'BEN-5' },
  ])
})
