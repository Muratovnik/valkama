/**
 * The new-task dialog writes its description in the same markdown editor the
 * card does: `#` offers the tasks of the space the task is created in, the
 * preview is the text as the card will draw it, and Ctrl+Enter is the dialog's
 * own Create — held back, as the button is, until there is a title.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import { createWorkItem } from '@/shared/api/planningApi.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItem } from '../browser/planningFixtures.ts'

vi.mock('@/shared/api/planningApi.ts', () => ({ createWorkItem: vi.fn() }))
vi.mock('@/shared/api/planningSearchApi.ts', () => ({ searchPlanningWorkItems: vi.fn() }))

const SPACE = '7a1c2f3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

function mountComposer(locale = 'en') {
  return mount(WorkItemComposer, {
    attachTo: document.body,
    props: { open: true, space: SPACE },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { OverlayHost: { template: '<div><slot /></div>' } },
    },
  })
}

async function typeDescription(wrapper: ReturnType<typeof mountComposer>, value: string) {
  const field = wrapper.get<HTMLTextAreaElement>('textarea')
  field.element.focus()
  await field.setValue(value)
  field.element.setSelectionRange(value.length, value.length)
  await field.trigger('input')
}

describe('WorkItemComposer description', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(createWorkItem).mockReset()
    vi.mocked(createWorkItem).mockResolvedValue(validateWorkItemRecord(workItem))
    vi.mocked(searchPlanningWorkItems).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('creates on Ctrl+Enter in the description, and only once there is a title', async () => {
    const wrapper = mountComposer()
    await typeDescription(wrapper, 'See **MAIN-12**')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(createWorkItem).not.toHaveBeenCalled()

    await wrapper.get('input').setValue('Ship the parser')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    expect(createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        space: SPACE,
        title: 'Ship the parser',
        description: 'See **MAIN-12**',
      }),
    )
    expect(wrapper.emitted('created')).toEqual([['MAIN-264']])
  })

  it('offers the tasks of the space it creates in for # and writes the chosen one', async () => {
    vi.mocked(searchPlanningWorkItems).mockResolvedValue([
      {
        work_item_id: '11111111-2222-4333-8444-555555555555',
        planning_space_id: SPACE,
        reference: 'MAIN-12',
        title: 'Parser',
        state: { name: 'Doing' },
        claim_ref: '',
      },
    ])
    const wrapper = mountComposer()
    await typeDescription(wrapper, 'After #pars')
    await vi.advanceTimersByTimeAsync(250)
    expect(searchPlanningWorkItems).toHaveBeenCalledWith('pars', SPACE, expect.any(AbortSignal))
    expect(wrapper.get('[role="listbox"]').text()).toContain('Parser')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('After MAIN-12 ')
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('previews the description as the card will draw it, in Russian too', async () => {
    const wrapper = mountComposer('ru')
    await typeDescription(wrapper, 'Нужно **срочно**')
    const preview = wrapper
      .findAll('button[aria-pressed]')
      .find((option) => option.text() === 'Просмотр')
    expect(preview).toBeDefined()
    await preview?.trigger('click')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.get('.markdown-preview strong').text()).toBe('срочно')
    expect(wrapper.get('input').attributes('maxlength')).toBe('200')
  })

  it('opens again on an empty description in the write view', async () => {
    const wrapper = mountComposer()
    await typeDescription(wrapper, 'draft')
    const preview = wrapper
      .findAll('button[aria-pressed]')
      .find((option) => option.text() === 'Preview')
    await preview?.trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
  })
})
