/**
 * The segmented control as a radio group (WAI-ARIA APG): one Tab stop on the chosen segment,
 * and the arrows, Home and End moving focus and the choice together, past a segment that
 * cannot be chosen and around the ends. Given tab ids, it is a tab list over a panel: the
 * arrows show a panel that shows at once, and only move focus over one that does not.
 */
import { defineComponent, h, ref } from 'vue'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { useTabIds } from '@/shared/ui/tabIds.ts'
import TabPanel from '@/shared/ui/TabPanel.vue'

import { present } from '../support/present.ts'

const OPTIONS = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List', disabled: true },
  { value: 'graph', label: 'Graph' },
  { value: 'chain', label: 'Chain' },
]

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function pressOn(target: Element | null, key: string) {
  target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

function render(start: string | null = 'board', options: typeof OPTIONS = OPTIONS) {
  const chosen = ref(start)
  const draw = () =>
    h(SegmentedControl<string>, {
      'label': 'View',
      'modelValue': chosen.value,
      'options': options,
      'onUpdate:modelValue': (value: string) => (chosen.value = value),
    })
  const Host = defineComponent(() => draw)
  const wrapper = mount(Host, { attachTo: document.body })
  mounted.push(wrapper)
  const segment = (label: string) =>
    present(
      wrapper.findAll('[role="radio"]').find((node) => node.text() === label),
      label,
    )
  const press = async (key: string) => {
    pressOn(document.activeElement, key)
    await wrapper.vm.$nextTick()
  }
  return { chosen, press, segment, wrapper }
}

const focusedText = () => document.activeElement?.textContent?.trim()

describe('SegmentedControl', () => {
  it('is a radio group whose chosen segment is checked and the one Tab stop', () => {
    const { segment, wrapper } = render('graph')
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('View')
    expect(segment('Graph').attributes('aria-checked')).toBe('true')
    expect(segment('Board').attributes('aria-checked')).toBe('false')
    expect(wrapper.findAll('[tabindex="0"]').map((node) => node.text())).toEqual(['Graph'])
  })

  it('moves focus and the choice with the arrows, past what cannot be chosen', async () => {
    const { chosen, press, segment } = render()
    ;(segment('Board').element as HTMLElement).focus()
    await press('ArrowRight')
    expect(focusedText()).toBe('Graph')
    expect(chosen.value).toBe('graph')
    expect(segment('Graph').attributes('tabindex')).toBe('0')
    await press('ArrowDown')
    expect(chosen.value).toBe('chain')
    await press('ArrowLeft')
    await press('ArrowUp')
    expect(focusedText()).toBe('Board')
    expect(chosen.value).toBe('board')
  })

  it('goes around the ends, and Home and End go to them', async () => {
    const { chosen, press, segment } = render()
    ;(segment('Board').element as HTMLElement).focus()
    await press('ArrowLeft')
    expect([focusedText(), chosen.value]).toEqual(['Chain', 'chain'])
    await press('ArrowRight')
    expect([focusedText(), chosen.value]).toEqual(['Board', 'board'])
    await press('End')
    expect([focusedText(), chosen.value]).toEqual(['Chain', 'chain'])
    await press('Home')
    expect([focusedText(), chosen.value]).toEqual(['Board', 'board'])
  })

  it('holds no value: nothing is pressed, and Tab stops on the first and chooses nothing', async () => {
    const { chosen, press, segment, wrapper } = render(null, [
      { value: 'later', label: 'Later', disabled: true },
      ...OPTIONS,
    ])
    expect(wrapper.findAll('[aria-checked="true"]')).toHaveLength(0)
    expect(wrapper.findAll('[tabindex="0"]').map((node) => node.text())).toEqual(['Board'])
    ;(segment('Board').element as HTMLElement).focus()
    expect(chosen.value).toBeNull()
    await press('ArrowRight')
    expect([focusedText(), chosen.value]).toEqual(['Graph', 'graph'])
  })

  it('a press on a segment chooses it when none was chosen', async () => {
    const { chosen, segment } = render(null)
    await segment('Chain').trigger('click')
    expect(chosen.value).toBe('chain')
  })

  it('a segment says what it opens to a reader, by the element the host names', () => {
    const options = OPTIONS.map((option) =>
      option.value === 'graph' ? { ...option, describedBy: 'graph-note' } : option,
    )
    const { segment } = render(null, options)
    expect(segment('Graph').attributes('aria-describedby')).toBe('graph-note')
    expect(segment('Board').attributes('aria-describedby')).toBeUndefined()
  })

  it('leaves a key with a modifier, and every other key, to the page', async () => {
    const { chosen, segment } = render()
    const board = segment('Board').element as HTMLElement
    board.focus()
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })
    board.dispatchEvent(event)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    board.dispatchEvent(tab)
    expect(chosen.value).toBe('board')
    expect(tab.defaultPrevented).toBe(false)
  })
})

/** The same control switching panels: a tab list over the one panel it shows (WAI-ARIA APG). */
function renderTabs(activation: 'automatic' | 'manual', start = 'board') {
  const chosen = ref(start)
  const Host = defineComponent(() => {
    const tabs = useTabIds()
    return () => [
      h(SegmentedControl<string>, {
        'label': 'Sections',
        'modelValue': chosen.value,
        'options': OPTIONS,
        'tabs': tabs,
        'activation': activation,
        'onUpdate:modelValue': (value: string) => (chosen.value = value),
      }),
      h(TabPanel, { tabs, value: chosen.value }, () => `Panel ${chosen.value}`),
    ]
  })
  const wrapper = mount(Host, { attachTo: document.body })
  mounted.push(wrapper)
  const tab = (label: string) =>
    present(
      wrapper.findAll('[role="tab"]').find((node) => node.text() === label),
      label,
    )
  const press = async (key: string) => {
    pressOn(document.activeElement, key)
    await wrapper.vm.$nextTick()
  }
  return { chosen, press, tab, wrapper }
}

describe('SegmentedControl as tabs', () => {
  it('is a tab list whose chosen tab is selected and controls the panel labelled by it', () => {
    const { tab, wrapper } = renderTabs('automatic', 'graph')
    expect(wrapper.findAll('[role="radiogroup"], [role="radio"]')).toHaveLength(0)
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Sections')
    expect(tab('Graph').attributes('aria-selected')).toBe('true')
    expect(tab('Board').attributes('aria-selected')).toBe('false')
    expect(tab('Graph').attributes('aria-checked')).toBeUndefined()
    const panel = wrapper.get('[role="tabpanel"]')
    expect(tab('Graph').attributes('aria-controls')).toBe(panel.attributes('id'))
    expect(panel.attributes('aria-labelledby')).toBe(tab('Graph').attributes('id'))
    // Only the panel shown is in the page, so only its tab points at it.
    expect(tab('Board').attributes('aria-controls')).toBeUndefined()
    expect(wrapper.findAll('[tabindex="0"]').map((node) => node.text())).toEqual(['Graph'])
  })

  it('shows the panel as the arrows reach its tab when it shows at once', async () => {
    const { chosen, press, tab, wrapper } = renderTabs('automatic')
    ;(tab('Board').element as HTMLElement).focus()
    await press('ArrowRight')
    expect([focusedText(), chosen.value]).toEqual(['Graph', 'graph'])
    expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(
      tab('Graph').attributes('id'),
    )
    await press('End')
    expect([focusedText(), chosen.value]).toEqual(['Chain', 'chain'])
    // Up and Down belong to the page: a row of tabs is walked left and right.
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(chosen.value).toBe('chain')
  })

  it('moves only focus with the arrows when a panel is slow to show, and Enter shows it', async () => {
    const { chosen, press, tab } = renderTabs('manual')
    ;(tab('Board').element as HTMLElement).focus()
    await press('ArrowRight')
    expect([focusedText(), chosen.value]).toEqual(['Graph', 'board'])
    expect(tab('Board').attributes('tabindex')).toBe('0')
    await tab('Graph').trigger('click')
    expect(chosen.value).toBe('graph')
  })
})
