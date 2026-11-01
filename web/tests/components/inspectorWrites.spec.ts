/**
 * The inspector's own writes against the server's answers to them.
 *
 * The planning client runs for real here and only `fetch` is a double, so a
 * refusal reaches the inspector the way the server words it — a status and a
 * `{ error: { code, message } }` body — rather than as an object a test built
 * to look like one.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

import { getButton, workItemFixture } from '../fixtures/workItem.ts'
import {
  choose,
  DONE,
  json,
  mountInspector,
  serveWrites,
  useInspectorHarness,
} from '../support/inspectorHarness.ts'

// The card asks for its chain on every open; this spec is about something else.
vi.mock('@/shared/api/planningChainApi.ts', async () => {
  const { noChainModule } = await import('../support/noChain.ts')
  return noChainModule()
})

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))

const SUMMARY_REFUSAL =
  '[summary] QA-320 has no closing summary; record what was done and what comes next before closing it'

const transitions = (writes: ReturnType<typeof serveWrites>) =>
  writes.filter((write) => write.path === '/api/planning/work-item/transition')

describe('inspector writes and their refusals', () => {
  useInspectorHarness()

  it('shows a refused move in the server’s words, with its next step and a confirmed override', async () => {
    const item = workItemFixture('Close me', 4)
    const writes = serveWrites({
      '/api/planning/work-item/transition': (body) =>
        body.force === true
          ? json({ ...item, state: DONE, revision: 5 })
          : json({ error: { code: 'workflow_guard', message: SUMMARY_REFUSAL } }, 409),
    })
    const wrapper = mountInspector(item)
    await flushPromises()

    await choose(wrapper, 'done')
    const notice = wrapper.get('.refusal')
    expect(notice.text()).toContain('Moving to “Done” was refused')
    expect(notice.text()).toContain('has no closing summary; record what was done')
    expect(notice.text()).toContain('There is no closing summary')
    expect(wrapper.text()).not.toContain('technical code')
    // The server's sentence is held to a few lines in the pinned head; the whole
    // of it stays in the document behind the toggle.
    const reason = notice.get('.refusal-reason .collapsible-text')
    expect(reason.classes()).toContain('clamped')
    expect(notice.get('.refusal-reason').attributes('style')).toContain('--collapsible-lines: 3')
    expect(reason.text()).toContain('before closing it')

    // The same choice again is a second request, not a no-op on a stale selection.
    await choose(wrapper, 'done')
    expect(transitions(writes)).toHaveLength(2)
    expect(transitions(writes).every((write) => write.body.force === undefined)).toBe(true)

    // Overriding is asked first, and only the second answer sends it.
    await getButton(wrapper, 'Move anyway').trigger('click')
    expect(wrapper.get('.confirm-strip').text()).toContain('against the workflow rules')
    expect(transitions(writes)).toHaveLength(2)
    await wrapper.get('.confirm-strip .confirm-go').trigger('click')
    await flushPromises()
    expect(transitions(writes).at(-1)?.body).toEqual({
      author: 'user',
      id: 'QA-320',
      state: 'done',
      force: true,
    })
    expect(wrapper.find('.refusal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('takes the guard’s next step where the inspector can: the outcome report composer', async () => {
    const item = workItemFixture('Close me', 4)
    serveWrites({
      '/api/planning/work-item/transition': () =>
        json({ error: { code: 'workflow_guard', message: SUMMARY_REFUSAL } }, 409),
    })
    const wrapper = mountInspector(item)
    await flushPromises()
    await choose(wrapper, 'done')
    await getButton(wrapper, 'Write the outcome').trigger('click')
    await flushPromises()
    expect(wrapper.find('.refusal').exists()).toBe(false)
    expect(wrapper.find('textarea[aria-label="What was done"]').exists()).toBe(true)
    const outcome = wrapper.findAll('.discussion-option input').at(-1)?.element as
      HTMLInputElement | undefined
    expect(outcome?.checked).toBe(true)
    wrapper.unmount()
  })

  it('offers release only on its own claim and a confirmed takeover on anyone else’s', async () => {
    const item = { ...workItemFixture('Held elsewhere', 2), claim_ref: 'claude' }
    const writes = serveWrites({
      '/api/planning/work-item/claim': (body) =>
        json({ ...item, claim_ref: body.release === true ? '' : 'user', revision: 3 }),
    })
    const wrapper = mountInspector(item)
    await flushPromises()

    expect(wrapper.findAll('.write-actions button').map((button) => button.text())).toEqual([
      'Take over',
    ])
    await getButton(wrapper, 'Take over').trigger('click')
    expect(wrapper.get('.confirm-strip').text()).toContain('claude holds this work')
    expect(writes).toHaveLength(0)

    vi.mocked(fetchWorkItem).mockResolvedValue({ ...item, claim_ref: 'user', revision: 3 })
    await wrapper.get('.confirm-strip .confirm-go').trigger('click')
    await flushPromises()
    expect(writes.at(-1)?.body).toEqual({ author: 'user', id: 'QA-320', force: true })
    expect(wrapper.findAll('.write-actions button').map((button) => button.text())).toEqual([
      'Release',
    ])

    vi.mocked(fetchWorkItem).mockResolvedValue({ ...item, claim_ref: '', revision: 4 })
    await getButton(wrapper, 'Release').trigger('click')
    await flushPromises()
    expect(writes.at(-1)?.body).toEqual({ author: 'user', id: 'QA-320', release: true })
    expect(wrapper.findAll('.write-actions button').map((button) => button.text())).toEqual([
      'Claim',
    ])
    wrapper.unmount()
  })

  it('takes a stale claim over as a plain claim, with nothing to confirm', async () => {
    const item: WorkItem = {
      ...workItemFixture('Abandoned', 2),
      claim_ref: 'codex',
      claim_state: 'stale',
      claim: {
        holder: 'codex',
        state: 'stale',
        session_id: '019a3c2e-0001-7c11-9e0f-2f4b6d8a1c3e',
        agent_id: null,
        source: 'codex-meta',
        acquired_at: '2026-08-01T10:00:00.000Z',
        last_seen: '2026-08-02T10:00:00Z',
        expires_at: null,
      },
    }
    const writes = serveWrites({
      '/api/planning/work-item/claim': () =>
        json({ ...item, claim_ref: 'user', claim_state: 'unconfirmed', revision: 4 }),
    })
    const wrapper = mountInspector(item)
    await flushPromises()

    // A lease nobody is behind any more is a warning dot on the holder, and
    // the holder's tooltip says why.
    const lease = wrapper.get('.card-holder [data-dimension="claim-lease"]')
    expect(lease.attributes('data-state')).toBe('stale')
    expect(lease.attributes('data-tone')).toBe('warning')
    expect(wrapper.get('.card-holder').attributes('title')).toBe(
      'Claim: Stale — the session behind it is gone',
    )
    expect(wrapper.findAll('.write-actions button').map((button) => button.text())).toEqual([
      'Take over',
    ])

    vi.mocked(fetchWorkItem).mockResolvedValue({
      ...item,
      claim_ref: 'user',
      claim_state: 'unconfirmed',
      claim: {
        holder: 'user',
        state: 'unconfirmed',
        session_id: null,
        agent_id: null,
        source: 'browser',
        acquired_at: '2026-08-27T18:00:00.000Z',
        last_seen: null,
        expires_at: null,
      },
      revision: 4,
    })
    await getButton(wrapper, 'Take over').trigger('click')
    await flushPromises()
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(writes.map((write) => write.body)).toEqual([{ author: 'user', id: 'QA-320' }])
    // The owner's own claim has no session behind it by design, so no lease is shown.
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)
    expect(wrapper.findAll('.write-actions button').map((button) => button.text())).toEqual([
      'Release',
    ])
    wrapper.unmount()
  })

  it('shows a live lease with its expiry and a takeover that still asks first', async () => {
    const item: WorkItem = {
      ...workItemFixture('Held live', 2),
      claim_ref: 'codex',
      claim_state: 'live',
      claim: {
        holder: 'codex',
        state: 'live',
        session_id: '019a3c2e-0001-7c11-9e0f-2f4b6d8a1c3e',
        agent_id: null,
        source: 'codex-meta',
        acquired_at: '2026-08-27T17:00:00.000Z',
        last_seen: '2026-08-27T18:00:00Z',
        expires_at: '2026-09-10T18:00:00Z',
      },
    }
    const writes = serveWrites({})
    const wrapper = mountInspector(item)
    await flushPromises()

    // A live lease is no warning: it is the holder's tooltip, read out with the name.
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)
    const holder = wrapper.get('.card-holder')
    // The date is the activity format, which this harness's i18n leaves blank.
    expect(holder.attributes('title')).toMatch(
      /^Claim: Live — until .*, unless the session shows a sign of life$/u,
    )
    expect(holder.text()).toContain('unless the session shows a sign of life')
    await getButton(wrapper, 'Take over').trigger('click')
    expect(wrapper.get('.confirm-strip').text()).toContain('codex holds this work')
    expect(writes).toHaveLength(0)
    wrapper.unmount()
  })
})
