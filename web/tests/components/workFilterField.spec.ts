/**
 * The filter field: three ways in — a preset, the menu and a mark clicked on a
 * view — that must make the same filter, and the keyboard of the Work bar.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkFilterField from '@/features/work-filter/WorkFilterField.vue'

import { EMPTY_WORK_FILTER, toggleToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

const items = [
  boardItem(1, 'backlog', { labels: ['ui', 'agent'], claim_ref: 'claude (session 1baa03d7)' }),
  boardItem(2, 'todo', { labels: ['ui'] }),
]

function field(filter: WorkFilter = EMPTY_WORK_FILTER, locale = 'en') {
  const wrapper = mount(WorkFilterField, {
    attachTo: document.body,
    props: {
      'categories': ['backlog', 'queued', 'review', 'blocked'] as const,
      'held': 7,
      items,
      filter,
      'onUpdate:filter': (next: WorkFilter) => wrapper.setProps({ filter: next }),
    },
    global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] },
  })
  return wrapper
}

const input = (wrapper: ReturnType<typeof field>) => wrapper.get('input[role="combobox"]')
const lastFilter = (wrapper: ReturnType<typeof field>) =>
  wrapper.emitted<[WorkFilter]>('update:filter')?.at(-1)?.[0]
const options = (wrapper: ReturnType<typeof field>) =>
  wrapper.findAll('[role="option"]').map((option) => option.text())
const option = (wrapper: ReturnType<typeof field>, name: string) => {
  const found = wrapper.findAll('[role="option"]').find((candidate) => candidate.text() === name)
  if (!found) throw new Error(`no option ${name}: ${options(wrapper).join(', ')}`)
  return found
}
const highlighted = (wrapper: ReturnType<typeof field>) =>
  wrapper.find('[role="option"][data-highlighted]').text()
const groupNames = (wrapper: ReturnType<typeof field>) =>
  wrapper.findAll('[role="listbox"] [role="group"] .option-group-name').map((name) => name.text())
const everywhere = (text: string) => `Search for “${text}” in all projects`
const FACETS = ['State', 'Kind', 'Priority', 'Holder', 'Label']

afterEach(() => {
  document.body.innerHTML = ''
})

/** A `/` pressed with focus on the target, heard by the window as a real key is. */
const press = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))

describe('the Work filter field', () => {
  it('makes the same filter from the menu and a mark on a view, with no presets beside it', async () => {
    const menu = field()
    // The conditions are the menu's, not buttons beside the field.
    expect(menu.findAll('button').map((button) => button.text())).toEqual([])
    await input(menu).trigger('click')
    await option(menu, 'Workable').trigger('click')
    const fromMenu = lastFilter(menu)

    // What the workspace does with a `filter` event from a tile or a row.
    const fromMark = toggleToken(EMPTY_WORK_FILTER, { facet: 'ready' })
    expect(fromMenu).toEqual(fromMark)

    const held = field()
    await input(held).trigger('click')
    await option(held, 'Has a holder7').trigger('click')
    expect(lastFilter(held)).toEqual(toggleToken(EMPTY_WORK_FILTER, { facet: 'held' }))

    const label = field()
    await input(label).trigger('click')
    await option(label, 'Label').trigger('click')
    await option(label, 'ui').trigger('click')
    expect(lastFilter(label)).toEqual(
      toggleToken(EMPTY_WORK_FILTER, { facet: 'labels', value: 'ui' }),
    )
  })

  it('opens on the facets under the conditions, and a facet’s row steps into its values', async () => {
    const wrapper = field()
    await input(wrapper).trigger('click')
    expect(input(wrapper).attributes('aria-expanded')).toBe('true')
    expect(groupNames(wrapper)).toEqual(['Conditions', 'Filter by'])
    // The held condition says how many it lets through, as its preset did.
    expect(options(wrapper)).toEqual(['Workable', 'Has a holder7', ...FACETS])
    expect(option(wrapper, 'Has a holder7').get('.option-detail').text()).toBe('7')
    // A facet's row leads somewhere and is no value, so it is not «not selected» either.
    for (const name of FACETS)
      expect(option(wrapper, name).attributes('aria-selected')).toBeUndefined()

    await option(wrapper, 'Holder').trigger('click')
    // Holders by the name the claim gives; the group's name is the way back.
    expect(options(wrapper)).toEqual(['Holder', 'claude'])
    expect(option(wrapper, 'Holder').attributes('aria-label')).toBe('Holder: back to the facets')
    await option(wrapper, 'Holder').trigger('click')
    expect(options(wrapper)).toEqual(['Workable', 'Has a holder7', ...FACETS])

    // Labels by how many items carry them, under the choice of how they combine.
    await option(wrapper, 'Label').trigger('click')
    expect(options(wrapper)).toEqual(['Label', 'all', 'any', 'ui', 'agent'])
    expect(wrapper.findAll('.option-row')).toHaveLength(2)
  })

  it('finds a value of any facet from the facets, and Enter takes it into its own facet', async () => {
    const wrapper = field()
    await input(wrapper).setValue('prio')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    // A facet's name offers its every value; the text's own search ends the list.
    expect(options(wrapper)).toEqual(['Urgent', 'High', 'Medium', 'Low', everywhere('prio')])
    await input(wrapper).setValue('hig')
    expect(options(wrapper)).toEqual(['High', everywhere('hig')])
    expect(input(wrapper).attributes('aria-activedescendant')).toBe(
      wrapper.get('[role="option"]').attributes('id'),
    )
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    // The text found the value; it was not a search of the work.
    expect(lastFilter(wrapper)).toEqual({ text: '', priority: ['high'] })
    await flushPromises()
    // The pick stands highlighted among the other priorities.
    expect(options(wrapper)).toEqual(['Priority', 'Urgent', 'High', 'Medium', 'Low'])
    expect(highlighted(wrapper)).toBe('High')
    expect(option(wrapper, 'High').attributes('aria-selected')).toBe('true')
  })

  it('narrows a facet’s values to the text, and the facets’ names are not searched there', async () => {
    const wrapper = field()
    await input(wrapper).trigger('click')
    await option(wrapper, 'Label').trigger('click')
    await input(wrapper).setValue('agen')
    expect(options(wrapper)).toEqual(['Label', 'agent', everywhere('agen')])
    await input(wrapper).setValue('label')
    expect(options(wrapper)).toEqual(['Label', everywhere('label')])
  })

  it('leaves the labels’ choice out of a list narrowed to some of them', async () => {
    const wrapper = field()
    await input(wrapper).setValue('agen')
    expect(options(wrapper)).toEqual(['agent', everywhere('agen')])
    // The facet's own name offers all of it, and the choice is part of that.
    await input(wrapper).setValue('label')
    expect(options(wrapper)).toEqual(['all', 'any', 'ui', 'agent', everywhere('label')])
  })

  it('walks the steps by keyboard: Enter in, ← or Backspace out, and ← past them to the chips', async () => {
    const wrapper = field({ text: '', kind: ['bug'] })
    const element = input(wrapper).element as HTMLInputElement
    element.focus()
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(highlighted(wrapper)).toBe('Workable')
    for (let step = 0; step < 3; step += 1)
      await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(highlighted(wrapper)).toBe('Kind')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    // In on the first value, which the field names to assistive technology.
    expect(options(wrapper)[0]).toBe('Kind')
    expect(highlighted(wrapper)).toBe(options(wrapper)[1])
    expect(input(wrapper).attributes('aria-activedescendant')).toBe(
      wrapper.get('[role="option"][data-highlighted]').attributes('id'),
    )

    await input(wrapper).trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    // Back on the facet it went into, and the chips are not reached on the way.
    expect(highlighted(wrapper)).toBe('Kind')
    expect(wrapper.emitted('chips')).toBeUndefined()

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await input(wrapper).trigger('keydown', { key: 'Backspace' })
    await flushPromises()
    expect(highlighted(wrapper)).toBe('Kind')
    expect(lastFilter(wrapper)).toBeUndefined()

    // From the facets the keys are the chips' again.
    await input(wrapper).trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('chips')).toHaveLength(1)
  })

  it('hands the text to the search over every project from the menu’s last row', async () => {
    const wrapper = field()
    await input(wrapper).setValue('  login form ')
    expect(options(wrapper)).toEqual([everywhere('login form')])
    // ↑ from no highlight reaches the last row, which is that search.
    await input(wrapper).trigger('keydown', { key: 'ArrowUp' })
    expect(highlighted(wrapper)).toBe(everywhere('login form'))
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('find')).toEqual([['login form']])
    expect(input(wrapper).attributes('aria-expanded')).toBe('false')
    // The filter keeps its text: the board stays narrowed as it was.
    expect(lastFilter(wrapper)).toEqual({ text: '  login form ' })

    // A facet's step ends with it too.
    const inside = field()
    await input(inside).trigger('click')
    await option(inside, 'Label').trigger('click')
    await input(inside).setValue('ui')
    await option(inside, everywhere('ui')).trigger('click')
    expect(inside.emitted('find')).toEqual([['ui']])
  })

  it('says the menu’s rows in Russian', async () => {
    const wrapper = field(EMPTY_WORK_FILTER, 'ru')
    expect(input(wrapper).attributes('placeholder')).toBe('Фильтр: номер, название…')
    await input(wrapper).setValue('сборка')
    expect(options(wrapper)).toEqual(['Искать «сборка» во всех проектах'])
  })

  it('takes one step per Escape and keeps the press from what is behind it', async () => {
    const wrapper = field({ text: 'ui' })
    const behind = vi.fn()
    const escapeBehind = (event: KeyboardEvent) => event.key === 'Escape' && behind()
    document.addEventListener('keydown', escapeBehind)
    const element = input(wrapper).element as HTMLInputElement
    element.focus()
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(input(wrapper).attributes('aria-expanded')).toBe('true')

    await input(wrapper).trigger('keydown', { key: 'Escape' })
    expect(input(wrapper).attributes('aria-expanded')).toBe('false')
    expect(element.value).toBe('ui')

    await input(wrapper).trigger('keydown', { key: 'Escape' })
    expect(element.value).toBe('')
    expect(document.activeElement).toBe(element)

    await input(wrapper).trigger('keydown', { key: 'Escape' })
    expect(document.activeElement).not.toBe(element)
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', escapeBehind)
  })

  it('takes out the last facet with Backspace and asks for the chips with ←', async () => {
    const wrapper = field({ text: '', labels: ['ui'], kind: ['bug'] })
    const element = input(wrapper).element as HTMLInputElement
    element.focus()
    await input(wrapper).trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('chips')).toHaveLength(1)
    await input(wrapper).trigger('keydown', { key: 'Backspace' })
    expect(lastFilter(wrapper)).toEqual({ text: '', kind: ['bug'] })
    // Inside the text the keys are the text's.
    await input(wrapper).setValue('ab')
    element.setSelectionRange(2, 2)
    await input(wrapper).trigger('keydown', { key: 'Backspace' })
    expect(lastFilter(wrapper)).toEqual({ text: 'ab', kind: ['bug'] })
  })

  it('comes to `/` from the page, but not from a text field or under a dialog', async () => {
    const wrapper = field()
    const element = input(wrapper).element as HTMLInputElement
    const other = document.createElement('textarea')
    document.body.append(other)
    other.focus()
    press(other)
    expect(document.activeElement).toBe(other)

    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    press(document.body)
    expect(document.activeElement).not.toBe(element)
    dialog.remove()

    press(document.body)
    expect(document.activeElement).toBe(element)
  })
})
