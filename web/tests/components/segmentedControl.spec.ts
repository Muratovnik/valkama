/**
 * The segmented control as a radio group (WAI-ARIA APG): one Tab stop on the chosen segment,
 * and the arrows, Home and End moving focus and the choice together, past a segment that
 * cannot be chosen and around the ends.
 */
import { defineComponent, h, ref } from 'vue'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

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

function render(start = 'board') {
  const chosen = ref(start)
  const draw = () =>
    h(SegmentedControl<string>, {
      'label': 'View',
      'modelValue': chosen.value,
      'options': OPTIONS,
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
