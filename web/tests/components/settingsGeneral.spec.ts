import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsGeneral from '@/pages/settings/components/SettingsGeneral.vue'

import { messages } from '@/shared/i18n/index.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const catalog = [
  { kind: 'vscode' as const, availability: 'available' as const },
  { kind: 'codex-app' as const, availability: 'available' as const },
  { kind: 'terminal' as const, availability: 'unavailable' as const },
  { kind: 'cursor' as const, availability: 'unavailable' as const },
  { kind: 'custom' as const, availability: 'available' as const },
]

function mountGeneral() {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(SettingsGeneral, {
    props: { locale: 'en' },
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('SettingsGeneral opener catalog', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.assign(window, {
      valkamaDesktop: {
        listSessionOpeners: vi.fn().mockResolvedValue(catalog),
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'valkamaDesktop')
  })

  it('shows only compatible available desktop openers and repairs vanished selections', async () => {
    const wrapper = mountGeneral()
    await flushPromises()

    const controls = wrapper.findAllComponents(SelectionControl)
    const claude = controls[1]
    const codex = controls[2]
    const other = controls[3]
    expect(claude?.props('options').map(({ value }) => value)).toEqual(['vscode', 'custom'])
    expect(codex?.props('options').map(({ value }) => value)).toEqual([
      'vscode',
      'codex-app',
      'custom',
    ])
    expect(other?.props('options').map(({ value }) => value)).toEqual(['vscode', 'custom'])
    expect(codex?.props('modelValue')).toBe('vscode')
    expect(wrapper.findAll('.settings-general-opener-state')).toHaveLength(3)
    expect(wrapper.findAll('[data-state="ready"]')).toHaveLength(3)
  })

  it('validates an empty custom command beside the field', async () => {
    const wrapper = mountGeneral()
    await flushPromises()
    const claude = wrapper.findAllComponents(SelectionControl)[1]
    claude?.vm.$emit('update:modelValue', 'custom')
    await wrapper.vm.$nextTick()

    const command = wrapper.getComponent(VTextInput)
    command.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a command before selecting it.')
  })

  it('uses the bounded browser catalog when the desktop check fails', async () => {
    Object.assign(window, {
      valkamaDesktop: {
        listSessionOpeners: vi.fn().mockRejectedValue(new Error('C:\\private\\probe.log')),
      },
    })
    const wrapper = mountGeneral()
    await flushPromises()

    expect(wrapper.get('.settings-general-catalog-note').text()).toContain(
      'Application availability could not be checked',
    )
    expect(wrapper.text()).not.toContain('C:\\private\\probe.log')
    expect(
      wrapper
        .findAllComponents(SelectionControl)[2]
        ?.props('options')
        .map(({ value }) => value),
    ).toEqual(['vscode', 'custom'])
    expect(wrapper.findAllComponents(SelectionControl)[2]?.props('modelValue')).toBe('terminal')
  })

  it('treats an existing bridge without the mandatory catalog method as failed discovery', async () => {
    Object.assign(window, { valkamaDesktop: { openSource: vi.fn() } })
    const wrapper = mountGeneral()
    await flushPromises()

    expect(wrapper.get('.settings-general-catalog-note').exists()).toBe(true)
    expect(wrapper.findAllComponents(SelectionControl)[2]?.props('modelValue')).toBe('terminal')
  })

  it('uses the shared empty state when discovery finds no available destination', async () => {
    Object.assign(window, {
      valkamaDesktop: {
        listSessionOpeners: vi
          .fn()
          .mockResolvedValue(catalog.map((entry) => ({ ...entry, availability: 'unavailable' }))),
      },
    })
    const wrapper = mountGeneral()
    await flushPromises()

    expect(wrapper.get('.data-empty').text()).toContain('No session opener is available')
    expect(wrapper.findAllComponents(SelectionControl)).toHaveLength(1)
  })
})
