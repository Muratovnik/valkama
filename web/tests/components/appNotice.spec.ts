/**
 * The shell's notice: it can be put away, it can carry one action, and the next
 * notice replaces it whole — its action included.
 */
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AppNotice from '@/app/components/AppNotice.vue'
import { useShellNotice } from '@/app/composables/useShellNotice.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

/** The notice as App wires it: the composable's state rendered by the component. */
function shell() {
  let notice!: ReturnType<typeof useShellNotice>
  const Host = defineComponent({
    setup() {
      notice = useShellNotice()
      return () =>
        h(AppNotice, {
          notice: notice.current.value,
          onAct: notice.act,
          onDismiss: notice.dismiss,
        })
    },
  })
  const wrapper = mount(Host, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'ru', messages, pluralRules })],
    },
  })
  return { notice: () => notice, wrapper }
}

describe('the shell notice', () => {
  // A region that arrives with its words is not announced: assistive technology watches
  // a region for changes, and it has to be there before the change.
  it('keeps its status region with no notice, the same element from empty to spoken', async () => {
    const run = shell()
    const region = run.wrapper.get('[role="status"]')
    expect(region.text()).toBe('')
    expect(run.wrapper.find('.notice').exists()).toBe(false)
    run.notice().say('Путь скопирован', 'done')
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('[role="status"]').element).toBe(region.element)
    expect(region.text()).toBe('Путь скопирован')
    run.notice().dismiss()
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('[role="status"]').element).toBe(region.element)
    expect(region.text()).toBe('')
  })

  // NVDA and JAWS read an identical sentence again only after a clear and a pause.
  it('announces the same sentence twice by emptying the region and pausing', async () => {
    vi.useFakeTimers()
    const run = shell()
    const region = run.wrapper.get('[role="status"]')
    run.notice().say('Путь скопирован', 'done')
    await run.wrapper.vm.$nextTick()
    expect(region.text()).toBe('Путь скопирован')
    run.notice().say('Путь скопирован', 'done')
    await run.wrapper.vm.$nextTick()
    expect(region.text()).toBe('')
    expect(run.wrapper.get('.notice-message').text()).toBe('Путь скопирован')
    await vi.advanceTimersByTimeAsync(100)
    expect(region.text()).toBe('Путь скопирован')
    vi.useRealTimers()
  })

  it('does not speak a sentence left waiting once it is put away', async () => {
    vi.useFakeTimers()
    const run = shell()
    const region = run.wrapper.get('[role="status"]')
    run.notice().say('Первое', 'done')
    await run.wrapper.vm.$nextTick()
    run.notice().say('Второе', 'done')
    await run.wrapper.vm.$nextTick()
    run.notice().dismiss()
    await run.wrapper.vm.$nextTick()
    await vi.advanceTimersByTimeAsync(200)
    expect(region.text()).toBe('')
    vi.useRealTimers()
  })

  it('shows its words once to assistive technology, with what can be done about them', async () => {
    const run = shell()
    run.notice().say('Состояние вида сброшено.', 'done', { label: 'Вернуть', run: vi.fn() })
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('[role="status"]').text()).toBe('Состояние вида сброшено. Вернуть')
    expect(run.wrapper.get('.notice-message').attributes('aria-hidden')).toBe('true')
    expect(run.wrapper.get('.notice-action').attributes('aria-hidden')).toBeUndefined()
  })

  it('is put away by its close button, which says what it closes', async () => {
    const run = shell()
    run.notice().say('Данные доски обновлены', 'done')
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('[role="status"]').text()).toBe('Данные доски обновлены')
    const close = run.wrapper.get('button[aria-label="Закрыть уведомление"]')
    await close.trigger('click')
    expect(run.wrapper.find('.notice').exists()).toBe(false)
    expect(run.wrapper.get('[role="status"]').text()).toBe('')
    expect(run.notice().current.value).toBeNull()
  })

  it('carries one action, which runs once and answers the notice', async () => {
    const run = shell()
    const reload = vi.fn()
    run.notice().say('Состояние вида сброшено.', 'done', { label: 'Вернуть', run: reload })
    await run.wrapper.vm.$nextTick()
    await run.wrapper.get('.notice-action').trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(run.wrapper.find('.notice').exists()).toBe(false)
  })

  it('is replaced whole by the next notice, so an old action never rides on new words', async () => {
    const run = shell()
    run.notice().say('Первое', 'done', { label: 'Вернуть', run: vi.fn() })
    run.notice().say('Второе', 'done')
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('.notice-message').text()).toBe('Второе')
    expect(run.wrapper.find('.notice-action').exists()).toBe(false)
  })

  // Its going is the browser suite's, on a real window; these are what a writer chooses.
  it.each([
    ['what was done', 'done', undefined, 0],
    ['a refusal', 'refused', undefined, 1],
    ['what was done with an action on it', 'done', { label: 'Вернуть', run: () => {} }, 1],
  ] as const)('after its time, %s leaves %#', async (_name, kind, action, left) => {
    vi.useFakeTimers()
    const run = shell()
    run.notice().say('Слова', kind, action)
    await run.wrapper.vm.$nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.findAll('.notice')).toHaveLength(left)
    vi.useRealTimers()
  })
})
