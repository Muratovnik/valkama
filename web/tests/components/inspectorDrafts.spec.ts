/**
 * Unsent text in the inspector against every way of leaving it.
 *
 * A draft is asked about before a close, a step back, a related item, a route
 * change the inspector did not start, and a reload; nothing is asked when there
 * is nothing to lose. Only `fetch` is a double, as in the writes spec.
 */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'
import { mayLeave } from '@/shared/lib/leaveGuard.ts'

import { getButton, workItemFixture } from '../fixtures/workItem.ts'
import {
  DONE,
  drawerFrameStub,
  mountInspector,
  serveWrites,
  useInspectorHarness,
} from '../support/inspectorHarness.ts'

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))

const BLOCKER = {
  kind: 'blocks' as const,
  direction: 'incoming' as const,
  work_item_id: '00000000-0000-4000-8000-000000000100',
  reference: 'QA-100',
  title: 'The step before',
}
const OPEN_STEP = {
  id: '00000000-0000-4000-8000-000000000501',
  text: 'Write the migration',
  done: false,
  claimed_by: '',
  done_by: '',
}

const comment = (wrapper: VueWrapper) =>
  (wrapper.get('textarea[aria-label="Comment"]').element as HTMLTextAreaElement).value

const headings = (wrapper: VueWrapper) => wrapper.findAll('h3').map((heading) => heading.text())

/** A cancelable `beforeunload`, as a reload or a closing tab sends it. */
function unload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('inspector drafts and the ways of leaving them', () => {
  useInspectorHarness()

  it('asks before a close or a step back would drop an unsent comment or description', async () => {
    const item = workItemFixture('Drafts', 1)
    serveWrites({})
    const wrapper = mountInspector(item)
    await flushPromises()
    const frame = wrapper.getComponent(drawerFrameStub)

    // Nothing typed, nothing to lose: close goes straight through.
    frame.vm.$emit('close')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('textarea[aria-label="Comment"]').setValue('Half a thought')
    frame.vm.$emit('close')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.get('.confirm-strip').text()).toContain('Unsaved changes will be lost: comment')

    await getButton(wrapper, 'Keep editing').trigger('click')
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(
      (wrapper.get('textarea[aria-label="Comment"]').element as HTMLTextAreaElement).value,
    ).toBe('Half a thought')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('.description-heading button').trigger('click')
    await wrapper.get('textarea[aria-label="Description"]').setValue('A new goal')
    await getButton(wrapper, 'Back').trigger('click')
    expect(wrapper.emitted('back')).toBeUndefined()
    expect(wrapper.get('.confirm-strip').text()).toContain('description, comment')
    await getButton(wrapper, 'Discard').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
    wrapper.unmount()
  })

  it('asks before opening a related item would drop an unsent comment', async () => {
    const item = { ...workItemFixture('Drafts', 1), links: [BLOCKER] }
    serveWrites({})
    const wrapper = mountInspector(item)
    await flushPromises()

    await wrapper.get('textarea[aria-label="Comment"]').setValue('Half a thought')
    await getButton(wrapper, 'Relations').trigger('click')
    await wrapper.get('.link-open').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(wrapper.get('.confirm-strip').text()).toContain('Unsaved changes will be lost: comment')

    await getButton(wrapper, 'Keep editing').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(comment(wrapper)).toBe('Half a thought')

    await wrapper.get('.link-open').trigger('click')
    await flushPromises()
    await getButton(wrapper, 'Discard').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toEqual([['QA-100']])
    wrapper.unmount()
  })

  it('asks the same question for a move it did not start, and holds a reload only while a draft exists', async () => {
    const item = workItemFixture('Drafts', 1)
    serveWrites({})
    const wrapper = mountInspector(item)
    await flushPromises()

    // Nothing typed: the router may go, and a reload is not held.
    expect(await mayLeave()).toBe(true)
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(unload()).toBe(false)

    await wrapper.get('textarea[aria-label="Comment"]').setValue('Half a thought')
    expect(unload()).toBe(true)

    // Browser Back, global search, the rail: the router asks the inspector.
    const kept = mayLeave()
    await flushPromises()
    expect(wrapper.get('.confirm-strip').text()).toContain('Unsaved changes will be lost: comment')
    await getButton(wrapper, 'Keep editing').trigger('click')
    expect(await kept).toBe(false)
    expect(comment(wrapper)).toBe('Half a thought')

    const dropped = mayLeave()
    await flushPromises()
    await getButton(wrapper, 'Discard').trigger('click')
    expect(await dropped).toBe(true)

    // A departure the inspector already asked about is not asked twice when it
    // turns into a route change.
    wrapper.getComponent(drawerFrameStub).vm.$emit('close')
    await flushPromises()
    await getButton(wrapper, 'Discard').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(await mayLeave()).toBe(true)
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)

    // That pass is spent on the move it was given for. A discarded departure
    // that never became a route change does not let a later move through.
    wrapper.getComponent(drawerFrameStub).vm.$emit('close')
    await flushPromises()
    await getButton(wrapper, 'Discard').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const later = mayLeave()
    await flushPromises()
    expect(wrapper.get('.confirm-strip').text()).toContain('Unsaved changes will be lost: comment')
    await getButton(wrapper, 'Keep editing').trigger('click')
    expect(await later).toBe(false)

    // Sent or cleared, the draft no longer holds a reload, and an unmounted
    // inspector holds nothing.
    await wrapper.get('textarea[aria-label="Comment"]').setValue('')
    expect(unload()).toBe(false)
    await wrapper.get('textarea[aria-label="Comment"]').setValue('Again')
    wrapper.unmount()
    expect(unload()).toBe(false)
    expect(await mayLeave()).toBe(true)
  })

  it('reports neither blockers nor a next step on a closed item', async () => {
    const open = { ...workItemFixture('Closed', 1), links: [BLOCKER], checklist: [OPEN_STEP] }
    serveWrites({})
    const live = mountInspector(open)
    await flushPromises()
    // The control: the same item while it is live reports both.
    expect(headings(live)).toEqual(
      expect.arrayContaining([
        messages.en.workItem.queue.blocked,
        messages.en.workItem.summaryNext,
      ]),
    )
    live.unmount()

    const closed = mountInspector({ ...open, state: DONE })
    await flushPromises()
    expect(headings(closed)).not.toContain(messages.en.workItem.queue.blocked)
    expect(headings(closed)).not.toContain(messages.en.workItem.summaryNext)
    expect(closed.text()).not.toContain('The step before')
    closed.unmount()
  })
})
