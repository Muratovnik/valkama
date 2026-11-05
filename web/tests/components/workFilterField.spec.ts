/**
 * The filter field: three ways in — a preset, the menu and a mark clicked on a
 * view — that must make the same filter, and the keyboard of the Work bar.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
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

afterEach(() => {
  document.body.innerHTML = ''
})

/** A `/` pressed with focus on the target, heard by the window as a real key is. */
const press = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))

describe('the Work filter field', () => {
  it('makes the same filter from a preset, the menu and a mark on a view', async () => {
    const preset = field()
    await preset.get('.filter-preset[aria-pressed="false"]').trigger('click')
    const fromPreset = lastFilter(preset)

    const menu = field()
    await input(menu).trigger('click')
    await menu.findAll('[role="option"]')[0]?.trigger('click')
    const fromMenu = lastFilter(menu)

    // What the workspace does with a `filter` event from a tile or a row.
    const fromMark = toggleToken(EMPTY_WORK_FILTER, { facet: 'ready' })
    expect(fromPreset).toEqual(fromMark)
    expect(fromMenu).toEqual(fromMark)

    const label = field()
    await input(label).trigger('click')
    const ui = label.findAll('[role="option"]').find((option) => option.text() === 'ui')
    await ui?.trigger('click')
    expect(lastFilter(label)).toEqual(
      toggleToken(EMPTY_WORK_FILTER, { facet: 'labels', value: 'ui' }),
    )
  })

  it('offers each facet’s values under its name, the held count on its preset', async () => {
    const wrapper = field()
    expect(wrapper.get('.filter-preset:last-child').text()).toBe('Assigned 7')
    await input(wrapper).trigger('click')
    expect(input(wrapper).attributes('aria-expanded')).toBe('true')
    const groups = wrapper
      .findAll('[role="listbox"] [role="group"] .option-group-name')
      .map((name) => name.text())
    expect(groups).toEqual(['Quick filters', 'State', 'Kind', 'Label', 'Priority', 'Holder'])
    // Labels by how many items carry them; holders by the name the claim gives.
    expect(options(wrapper)).toEqual(expect.arrayContaining(['ui', 'agent', 'claude']))
    expect(options(wrapper).indexOf('ui')).toBeLessThan(options(wrapper).indexOf('agent'))
  })

  it('narrows the menu to what is typed, and Enter takes the highlighted value', async () => {
    const wrapper = field()
    await input(wrapper).setValue('prio')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    // A facet's name offers its every value.
    expect(options(wrapper)).toEqual(['Urgent', 'High', 'Medium', 'Low'])
    await input(wrapper).setValue('hig')
    expect(options(wrapper)).toEqual(['High'])
    expect(input(wrapper).attributes('aria-activedescendant')).toBe(
      wrapper.get('[role="option"]').attributes('id'),
    )
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    // The text found the value; it was not a search of the work.
    expect(lastFilter(wrapper)).toEqual({ text: '', priority: ['high'] })
  })

  it('leaves the labels’ choice out of a list narrowed to some of them', async () => {
    const wrapper = field()
    await input(wrapper).setValue('agen')
    expect(options(wrapper)).toEqual(['agent'])
    // The facet's own name offers all of it, and the choice is part of that.
    await input(wrapper).setValue('label')
    expect(options(wrapper)).toEqual(['all', 'any', 'ui', 'agent'])
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
