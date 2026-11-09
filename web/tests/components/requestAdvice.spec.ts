/**
 * Why the asker recommends an option or a verdict, read on the recommendation's words.
 *
 * The owner's rule: the words show the why when pointed at, and from the keyboard when
 * focused; without a why they are the words they were, with nothing to press. A reader of the
 * option's control hears the why with the word, through what describes the control.
 */
import { h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import RequestVerdictRow from '@/features/input-requests/components/RequestVerdictRow.vue'

import type { InputRequestField, InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

const WHY = 'Nothing to migrate.'
const plugins = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages })] })
const tooltip = () => document.body.querySelector('[role="tooltip"]')

/** An option as a form's row shows it, its radio in the slot as `RequestField` places it. */
function row(option: InputRequestOption, toggleStop?: number) {
  return mount(RequestOption, {
    attachTo: document.body,
    props: { chosen: false, option, view: 'none', pressable: true, toggleStop },
    slots: {
      default: (slot: { labelId: string; describedBy?: string }) =>
        h('input', {
          'type': 'radio',
          'aria-labelledby': slot.labelId,
          'aria-describedby': slot.describedBy,
        }),
    },
    global: plugins(),
  })
}
function described(control: Element) {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.querySelector(`[id="${id}"]`)?.textContent ?? '')
    .join(' ')
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the why of a recommended option', () => {
  it('leaves a recommendation without a why the word it was, with nothing to press', () => {
    const wrapper = row({ id: 'keep', label: 'Keep it', recommended: true })
    expect(wrapper.text()).toContain('recommended')
    expect(wrapper.find('.request-option-words button').exists()).toBe(false)
  })

  it('shows the why on keyboard focus and closes it when focus leaves', async () => {
    const wrapper = row({ id: 'keep', label: 'Keep it', recommended: true, why: WHY })
    const words = wrapper.get('.request-option-words button')
    expect(words.text()).toBe('recommended')
    expect(tooltip()).toBeNull()
    await words.trigger('focus')
    expect(tooltip()?.textContent).toContain(WHY)
    await words.trigger('focusout', { relatedTarget: null })
    expect(tooltip()).toBeNull()
  })

  it('shows the why while a mouse points at the words and a moment after it leaves', async () => {
    vi.useFakeTimers()
    const wrapper = row({ id: 'keep', label: 'Keep it', recommended: true, why: WHY })
    const words = wrapper.get('.request-option-words button')
    await words.trigger('pointerenter', { pointerType: 'mouse' })
    expect(tooltip()?.textContent).toContain(WHY)
    await words.trigger('pointerleave', { pointerType: 'mouse' })
    expect(tooltip()).not.toBeNull()
    vi.advanceTimersByTime(300)
    await wrapper.vm.$nextTick()
    expect(tooltip()).toBeNull()
  })

  it('keeps a finger’s press open: lifting the finger is no leaving', async () => {
    vi.useFakeTimers()
    const wrapper = row({ id: 'keep', label: 'Keep it', recommended: true, why: WHY })
    const words = wrapper.get('.request-option-words button')
    await words.trigger('pointerenter', { pointerType: 'touch' })
    expect(tooltip()).toBeNull()
    await words.trigger('click')
    await words.trigger('pointerleave', { pointerType: 'touch' })
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(tooltip()?.textContent).toContain(WHY)
  })

  it('lets the control’s reader hear the why with the word', () => {
    const wrapper = row({ id: 'keep', label: 'Keep it', recommended: true, why: WHY })
    expect(described(wrapper.get('input').element)).toContain(`recommended`)
    expect(described(wrapper.get('input').element)).toContain(WHY)
  })

  it('makes the press a tab stop by the row’s rule for its toggle', () => {
    const option = { id: 'keep', label: 'Keep it', recommended: true, why: WHY }
    expect(row(option, -1).get('.request-option-words button').attributes('tabindex')).toBe('-1')
    expect(row(option, 0).get('.request-option-words button').attributes('tabindex')).toBe('0')
  })
})

describe('the why of a recommended verdict', () => {
  const field: InputRequestField = {
    id: 'p1',
    label: 'P1 Narrow the rule',
    type: 'verdict',
    required: false,
    options: [],
    recommended: 'accept',
  }
  const point = (change: Partial<InputRequestField>) =>
    mount(RequestVerdictRow, {
      attachTo: document.body,
      props: { disabled: false, field: { ...field, ...change } },
      global: plugins(),
    })

  it('shows the why of the advice on focus, and nothing to press without one', async () => {
    expect(point({}).find('.request-point-line button').exists()).toBe(false)
    const wrapper = point({ why: WHY })
    const words = wrapper.get('.request-point-line button')
    expect(words.text()).toBe('Agent: accept')
    await words.trigger('focus')
    expect(tooltip()?.textContent).toContain(WHY)
  })
})
