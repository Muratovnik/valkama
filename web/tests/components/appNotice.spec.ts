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
        notice.current.value
          ? h(AppNotice, {
              notice: notice.current.value,
              onAct: notice.act,
              onDismiss: notice.dismiss,
            })
          : null
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
  it('is put away by its close button, which says what it closes', async () => {
    const run = shell()
    run.notice().message.value = 'Данные доски обновлены'
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('[role="status"]').text()).toBe('Данные доски обновлены')
    const close = run.wrapper.get('button[aria-label="Закрыть уведомление"]')
    await close.trigger('click')
    expect(run.wrapper.find('[role="status"]').exists()).toBe(false)
    expect(run.notice().message.value).toBe('')
  })

  it('carries one action, which runs once and answers the notice', async () => {
    const run = shell()
    const reload = vi.fn()
    run.notice().say('Состояние вида сброшено.', { label: 'Вернуть', run: reload })
    await run.wrapper.vm.$nextTick()
    await run.wrapper.get('.notice-action').trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(run.wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('is replaced whole by the next notice, so an old action never rides on new words', async () => {
    const run = shell()
    run.notice().say('Первое', { label: 'Вернуть', run: vi.fn() })
    run.notice().message.value = 'Второе'
    await run.wrapper.vm.$nextTick()
    expect(run.wrapper.get('.notice-message').text()).toBe('Второе')
    expect(run.wrapper.find('.notice-action').exists()).toBe(false)
  })
})
