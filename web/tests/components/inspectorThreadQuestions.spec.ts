/**
 * A question standing in the threaded feed: what the card asks about before leaving it, and
 * what an answered question offers once its task is closed.
 */
import { defineComponent, h } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

import { getButton } from '../fixtures/workItem.ts'
import { requestEntry } from '../support/inputRequests.ts'
import { card, plugins, root, track, unmountAll } from '../support/threadCard.ts'

afterEach(unmountAll)

function answered(): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    status: 'answered',
    answers: { route: 'keep' },
    own: {},
    field_notes: {},
    note: null,
    answer_version: 1,
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 2,
  }
  return entry
}

/** The card's discussion under the inspector's draft guard, and what it would lose now. */
function guarded(item: WorkItem, questions: InputRequestEntry[]) {
  let unsaved: readonly string[] = []
  const Host = defineComponent({
    setup() {
      const guard = provideDraftGuard()
      return () => {
        unsaved = guard.unsaved.value
        return h(InspectorDiscussion, { item, writable: true, questions })
      }
    },
  })
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins } })
  track(wrapper)
  return { wrapper, unsaved: () => unsaved }
}

const otherOption = (wrapper: VueWrapper) => {
  const radio = wrapper
    .findAll('.thread-question input[type="radio"]')
    .find((input) => !(input.element as HTMLInputElement).checked)
  if (!radio) throw new Error('No other option to choose')
  return radio
}

describe('an answered question in the threaded feed', () => {
  it('counts a change of the options alone as a draft the card asks about', async () => {
    const { wrapper, unsaved } = guarded(card([root(1)]), [answered()])
    await getButton(wrapper, 'Change answer').trigger('click')
    await flushPromises()
    // The form opened on the answer in force holds nothing of its own yet.
    expect(unsaved()).toEqual([])
    await otherOption(wrapper).setValue(true)
    await flushPromises()
    expect(unsaved()).toEqual(['answer'])
  })

  it('offers no change of the answer on a closed task, and says how to get one', () => {
    const closed = card([root(1)])
    closed.state = { ...closed.state, key: 'done', category: 'completed', is_terminal: true }
    const { wrapper } = guarded(closed, [answered()])
    const question = wrapper.get('.thread-question')
    expect(question.text()).not.toContain('Change answer')
    expect(question.text()).toContain('Reopen the task to change this answer.')
  })

  it('offers the change while the task is open', () => {
    const { wrapper } = guarded(card([root(1)]), [answered()])
    expect(wrapper.get('.thread-question').text()).toContain('Change answer')
  })
})
