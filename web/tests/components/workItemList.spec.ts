/**
 * The list's rows as one composite: a single Tab stop that follows the row last
 * focused, arrows, Home/End and Page Up/Down that walk the rows, and Enter or a
 * click anywhere in a row that opens a card; and the head that offers a narrow
 * list's folded orders as one choice.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import WorkItemListHead from '@/widgets/work-item-views/components/WorkItemListHead.vue'
import { LIST_COLUMNS } from '@/widgets/work-item-views/utils/listColumns.ts'

import { i18n as appI18n } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { boardItem } from '../fixtures/board.ts'
import { i18n } from '../support/workItemBoardHarness.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

// Sorted by number for the reader's sake: the list sorts by Updated, and these
// were updated in the order of their numbers, so the newest leads.
const items = [1, 2, 3, 4].map((number) =>
  boardItem(number, 'backlog', { updated_at: `2026-10-0${number}T10:00:00Z` }),
)

async function list() {
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    props: { items, links: [] },
    global: { plugins: [i18n()] },
  })
  // The list listens once for all its rows, from the moment it is in the page.
  await flushPromises()
  return wrapper
}

const buttons = (wrapper: Awaited<ReturnType<typeof list>>) =>
  wrapper.findAll<HTMLButtonElement>('tbody .list-open')
const focusedReference = () => document.activeElement?.textContent?.trim()
const press = (key: string, extra: KeyboardEventInit = {}) =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  )

describe('the list rows', () => {
  it('are one Tab stop, the first row until another is focused', async () => {
    const wrapper = await list()
    const stops = buttons(wrapper).filter((button) => button.attributes('tabindex') === '0')
    expect(stops.map((button) => button.text())).toEqual(['MAIN-4'])
    buttons(wrapper)[2].element.focus()
    await wrapper.vm.$nextTick()
    const after = buttons(wrapper).filter((button) => button.attributes('tabindex') === '0')
    expect(after.map((button) => button.text())).toEqual(['MAIN-2'])
  })

  it('walk with the arrows, Home and End, and stop at either end', async () => {
    const wrapper = await list()
    buttons(wrapper)[0].element.focus()
    press('ArrowDown')
    expect(focusedReference()).toBe('MAIN-3')
    press('End')
    expect(focusedReference()).toBe('MAIN-1')
    press('ArrowDown')
    expect(focusedReference()).toBe('MAIN-1')
    press('Home')
    expect(focusedReference()).toBe('MAIN-4')
    press('ArrowUp')
    expect(focusedReference()).toBe('MAIN-4')
    // A modified arrow is someone else's shortcut.
    press('ArrowDown', { shiftKey: true })
    expect(focusedReference()).toBe('MAIN-4')
    await wrapper.vm.$nextTick()
    expect(buttons(wrapper)[0].attributes('tabindex')).toBe('0')
  })

  it('open the focused row’s card', async () => {
    const wrapper = await list()
    await buttons(wrapper)[1].trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-3']])
  })

  it('page down and up a screen of rows, and at least one', async () => {
    const wrapper = await list()
    buttons(wrapper)[0].element.focus()
    // The test page lays nothing out, so a screen here is one row.
    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(focusedReference()).toBe('MAIN-3')
    press('PageUp')
    expect(focusedReference()).toBe('MAIN-4')
    press('PageUp')
    expect(focusedReference()).toBe('MAIN-4')
  })

  it('open a card from a click anywhere in the row, from its reference', async () => {
    const wrapper = await list()
    await wrapper.findAll('tbody .list-name')[1].trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-3']])
    // Focused, so that closing the card comes back to this row.
    expect(focusedReference()).toBe('MAIN-3')
  })

  it('leave a click that ends a text selection, or one on a heading, alone', async () => {
    const wrapper = await list()
    const name = wrapper.findAll('tbody .list-name')[1]
    const range = document.createRange()
    range.selectNodeContents(name.element)
    document.getSelection()?.addRange(range)
    await name.trigger('click')
    document.getSelection()?.removeAllRanges()
    await wrapper.get('thead .list-sort').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('keep the Tab stop on the row a new order moved', async () => {
    const wrapper = await list()
    buttons(wrapper)[1].element.focus()
    await wrapper.get('thead .list-sort').trigger('click')
    const stops = buttons(wrapper).filter((button) => button.attributes('tabindex') === '0')
    expect(stops.map((button) => button.text())).toEqual(['MAIN-3'])
  })

  it('show the steps as a fraction under their heading, and a year only when it is not this one', async () => {
    const year = new Date().getFullYear()
    const wrapper = mount(WorkItemList, {
      props: {
        items: [
          boardItem(7, 'backlog', {
            updated_at: `${year}-03-04T10:00:00Z`,
            checklist: [
              { id: 'a', text: 'one', done: true, claimed_by: '', done_by: '' },
              { id: 'b', text: 'two', done: false, claimed_by: '', done_by: '' },
            ],
          }),
          boardItem(8, 'backlog', { updated_at: `${year - 1}-03-04T10:00:00Z` }),
        ],
        links: [],
      },
      // The application's own formats, which name the shortened date.
      global: { plugins: [appI18n] },
    })
    await flushPromises()
    const [recent, older] = wrapper.findAll('tbody tr').map((row) => row.findAll('td'))
    expect(recent[5].text()).toBe('1/2')
    expect(recent[6].text()).toContain('Mar')
    expect(recent[6].text()).not.toContain(String(year))
    expect(older[5].text()).toBe('—')
    expect(older[6].text()).toContain(String(year - 1))
  })
})

describe('the list head on a narrow list', () => {
  const folded = LIST_COLUMNS.filter((column) => !['reference', 'title'].includes(column.key))

  function head(sortKey: (typeof LIST_COLUMNS)[number]['key']) {
    return mount(WorkItemListHead, {
      props: {
        sortState: () => 'none' as const,
        columns: LIST_COLUMNS.filter((column) => !folded.includes(column)),
        descending: true,
        folded,
        narrow: true,
        sortKey,
      },
      global: { plugins: [i18n()] },
    })
  }

  it('offers the folded columns as one choice rather than a run of buttons', () => {
    const wrapper = head('title')
    expect(wrapper.findAll('.list-sort').map((sort) => sort.text())).toEqual(['Ref', 'Title'])
    const choice = wrapper.getComponent(ChoiceSelect)
    expect(choice.props('options').map((option) => option.value)).toEqual(
      folded.map((column) => column.key),
    )
    // Nothing to turn over until a folded order is the list's.
    expect(choice.props('modelValue')).toBe('')
    choice.vm.$emit('update:modelValue', 'priority')
    expect(wrapper.emitted('sort')).toEqual([['priority']])
  })

  it('turns a chosen folded order over from the same choice', () => {
    const wrapper = head('updated')
    const choice = wrapper.getComponent(ChoiceSelect)
    expect(choice.props('modelValue')).toBe('updated')
    const turn = choice.props('options').at(-1)
    expect(turn?.label).toBe('Sort ascending')
    choice.vm.$emit('update:modelValue', turn?.value)
    expect(wrapper.emitted('sort')).toEqual([['updated']])
  })
})
