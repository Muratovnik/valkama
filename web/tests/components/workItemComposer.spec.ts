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
import { PRIORITIES, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { doneState, workItem } from '../browser/planningFixtures.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/planningApi.ts', () => ({ createWorkItem: vi.fn() }))
vi.mock('@/shared/api/planningSearchApi.ts', () => ({ searchPlanningWorkItems: vi.fn() }))

const SPACE = '7a1c2f3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

function mountComposer(locale = 'en', items: readonly WorkItemBrief[] = []) {
  return mount(WorkItemComposer, {
    attachTo: document.body,
    props: { open: true, space: SPACE, items },
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
      .findAll('button[role="tab"]')
      .find((option) => option.text() === 'Просмотр')
    expect(preview).toBeDefined()
    await preview?.trigger('click')
    expect(wrapper.get('textarea').element.closest('[inert]')).not.toBeNull()
    expect(wrapper.get('.markdown-preview strong').text()).toBe('срочно')
    expect(wrapper.get('input').attributes('maxlength')).toBe('200')
  })

  it('opens again on an empty description in the write view', async () => {
    const wrapper = mountComposer()
    await typeDescription(wrapper, 'draft')
    const preview = wrapper
      .findAll('button[role="tab"]')
      .find((option) => option.text() === 'Preview')
    await preview?.trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
  })
})

describe('WorkItemComposer priority', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('says what each level means on the chosen value and on each option, in both languages', async () => {
    const cases = [
      {
        locale: 'en',
        label: 'Priority',
        options: [
          ['Low', 'Low — minor'],
          ['Medium', 'Medium — noticeably affects work, with a workaround'],
          ['High', 'High — serious; could block work'],
          ['Urgent', 'Urgent — blocks work or loses data'],
        ],
      },
      {
        locale: 'ru',
        label: 'Приоритет',
        options: [
          ['Низкий', 'Низкий — мелочь'],
          ['Средний', 'Средний — заметно влияет, есть обход'],
          ['Высокий', 'Высокий — серьёзно, может заблокировать'],
          ['Срочный', 'Срочный — блокирует работу или теряет данные'],
        ],
      },
    ] as const
    for (const { locale, label, options } of cases) {
      const wrapper = mountComposer(locale)
      const trigger = wrapper.get(`.choice-trigger[aria-label="${label}"]`)
      // The chosen value starts at medium, the default the model gives.
      expect(trigger.get('.choice-title').attributes('title'), locale).toBe(options[1]?.[1])
      await trigger.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      for (const [name, hover] of options) {
        const option = present(
          [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
            item.textContent?.includes(name),
          ),
          `${locale} option ${name}`,
        )
        expect(option.getAttribute('title'), `${locale} ${name}`).toBe(hover)
      }
      wrapper.unmount()
    }
  })

  it('has a meaning for every priority level in both catalogues', () => {
    for (const locale of ['en', 'ru'] as const) {
      for (const level of PRIORITIES) {
        expect(messages[locale].priorityMeaning.meaning[level], `${locale} ${level}`).toBeTruthy()
      }
    }
  })
})

const optionNames = () =>
  [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent?.trim())

/** A brief of the space's work, as the board holds it. */
const brief = (number: number, fields: Partial<WorkItemBrief>): WorkItemBrief => ({
  ...workItem,
  comment_count: 0,
  work_item_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  reference: `MAIN-${number}`,
  number,
  labels: [],
  ...fields,
})

describe('WorkItemComposer epic and labels', () => {
  beforeEach(() => {
    vi.mocked(createWorkItem).mockReset()
    vi.mocked(createWorkItem).mockResolvedValue(validateWorkItemRecord(workItem))
  })
  // The lists are portalled to the body, so each field is unmounted before the body is cleared.
  const mounted: ReturnType<typeof mountComposer>[] = []
  const open = () => {
    const wrapper = mountComposer('en', items)
    mounted.push(wrapper)
    return wrapper
  }
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
  })

  const items = [
    brief(3, { kind: 'epic', title: 'Old release', state: doneState }),
    brief(7, { kind: 'task', title: 'Holds two', container: true, labels: ['docs'] }),
    brief(12, { kind: 'epic', title: 'Parser', labels: ['platform'] }),
    // Inside another item, so it cannot hold a new one: the hierarchy is one level deep.
    brief(20, { kind: 'epic', title: 'Nested', parent_id: workItem.work_item_id }),
    brief(21, { kind: 'task', title: 'Plain', labels: ['platform', 'docs', 'platform-ui'] }),
    brief(22, { kind: 'bug', title: 'Another', labels: ['platform'] }),
  ]

  it('offers the epics and the labels the space has, in the order they are reached for', async () => {
    const wrapper = open()
    const [labels, epic] = wrapper.findAll('input[role="combobox"]')
    await epic?.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(optionNames()).toEqual([
      'No epic',
      'MAIN-12 · ParserDev',
      'MAIN-7 · Holds twoDev',
      'MAIN-3 · Old releaseDone',
    ])
    await epic?.trigger('keydown', { key: 'Escape' })
    await labels?.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(optionNames()).toEqual(['platform', 'docs', 'platform-ui'])
  })

  it('sends the chosen epic by its reference and the labels as a list', async () => {
    const wrapper = open()
    await wrapper.get('input').setValue('Ship it')
    const [labels, epic] = wrapper.findAll<HTMLInputElement>('input[role="combobox"]')
    for (const [field, words] of [
      [epic, 'pars'],
      [labels, 'docs'],
      [labels, 'release'],
    ] as const) {
      field?.element.focus()
      await field?.setValue(words)
      await flushPromises()
      await field?.trigger('keydown', { key: 'Enter' })
      await flushPromises()
    }
    expect(wrapper.text()).toContain('docs')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['docs', 'release'], parent: 'MAIN-12' }),
    )
  })

  it('sends no epic and no labels when none is chosen', async () => {
    const wrapper = open()
    await wrapper.get('input').setValue('Ship it')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const sent = vi.mocked(createWorkItem).mock.calls[0]?.[0]
    expect(sent?.labels).toEqual([])
    expect(sent).not.toHaveProperty('parent')
  })
})
