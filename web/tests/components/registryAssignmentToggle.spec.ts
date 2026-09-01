/**
 * What makes the assignment switch a switch and not a readout.
 *
 * The section used to hand it a value derived from the row it was rendering and
 * listen for a `change` on the side, so nothing in the file said the two halves
 * were one thing. Here the model is writable: assigning to it is the write, and
 * these two tests are the reason that distinction is worth stating — the value
 * sent is decided by the model, and the row's own busy state is what disables
 * the control, with no id compared against anything.
 */

import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RegistryAssignmentToggle from '@/widgets/settings-registry/components/RegistryAssignmentToggle.vue'

import { setAssignmentState } from '@/shared/api/platformApi.ts'
import type { RegistryAssignment } from '@/shared/api/platformApiTypes.ts'
import { messages } from '@/shared/i18n/index'

vi.mock('@/shared/api/platformApi.ts', () => ({ setAssignmentState: vi.fn() }))

const assignment: RegistryAssignment = {
  assignment_id: 'assignment-1',
  capability_id: 'memory.open',
  changed_by: 'operator',
  connection_ids: [],
  revision: 1,
  scope: { kind: 'installation' },
  state: 'enabled',
}

const toggle = (over: Partial<RegistryAssignment> = {}) =>
  mount(RegistryAssignmentToggle, {
    props: { assignment: { ...assignment, ...over } },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })

describe('RegistryAssignmentToggle', () => {
  beforeEach(() => {
    vi.mocked(setAssignmentState).mockReset()
    vi.mocked(setAssignmentState).mockResolvedValue(assignment)
  })

  it('writes the opposite of what the platform last said, at the revision it was told', async () => {
    const wrapper = toggle()
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()

    expect(setAssignmentState).toHaveBeenCalledWith('assignment-1', 'disabled')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    // The notice is cleared when the attempt starts, so a stale complaint does
    // not outlive the click that supersedes it.
    expect(wrapper.emitted('notice')).toEqual([['']])
  })

  it('keeps showing the last answer while its own write is in flight', async () => {
    let settle = (_: RegistryAssignment) => {}
    vi.mocked(setAssignmentState).mockReturnValue(
      new Promise<RegistryAssignment>((resolve) => {
        settle = resolve
      }),
    )
    const wrapper = toggle({ state: 'disabled' })
    await wrapper.get('[role="switch"]').trigger('click')

    const control = wrapper.get('[role="switch"]')
    expect(control.attributes('aria-checked')).toBe('false')
    expect(control.attributes('aria-busy')).toBe('true')
    expect(control.attributes('disabled')).toBeDefined()

    settle(assignment)
    await flushPromises()
    expect(wrapper.get('[role="switch"]').attributes('aria-busy')).toBeUndefined()
  })

  it('reports a localized refusal upward and leaves the switch where it was', async () => {
    vi.mocked(setAssignmentState).mockRejectedValue(new Error('state conflict'))
    const wrapper = toggle()
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('notice')).toEqual([
      [''],
      ['The assignment could not be changed. Refresh and try again.'],
    ])
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
  })
})
