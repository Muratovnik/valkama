import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import SettingsGeneral from '@/pages/settings/components/SettingsGeneral.vue'

import { messages } from '@/shared/i18n/index.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const FALLBACK = 'If the place is unknown or cannot be opened'

function mountGeneral() {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(SettingsGeneral, {
    props: { locale: 'en' },
    // The alerts group has its own spec, its own reads and its own controls.
    global: { plugins: [createPinia(), i18n], stubs: { SettingsAlerts: true } },
  })
}

/** One of the group's selects, by its accessible name. */
function select(wrapper: ReturnType<typeof mountGeneral>, label: string) {
  const found = wrapper
    .findAllComponents(SelectionControl)
    .find((control) => control.props('label') === label)
  if (!found) throw new Error(`no select named ${label}`)
  return found
}

function values(wrapper: ReturnType<typeof mountGeneral>, label: string): string[] {
  return select(wrapper, label)
    .props('options')
    .map(({ value }) => value)
}

describe('SettingsGeneral opening sessions and files', () => {
  beforeEach(() => localStorage.clear())

  it('offers each family only the places that can hold its sessions', () => {
    const wrapper = mountGeneral()
    expect(wrapper.text()).toContain('A session opens where it was last open.')
    expect(values(wrapper, `Claude Code: ${FALLBACK}`)).toEqual([
      'vscode',
      'vscode-insiders',
      'cursor',
      'windsurf',
      'terminal',
      'claude-desktop',
    ])
    expect(values(wrapper, `Codex: ${FALLBACK}`)).toContain('codex-app')
    expect(values(wrapper, `Codex: ${FALLBACK}`)).not.toContain('claude-desktop')
    expect(values(wrapper, 'Other clients: Always open in')).toEqual(['', 'custom'])
    expect(select(wrapper, 'Editor for files').props('modelValue')).toBe('vscode')
  })

  it('says beside the family when a place replaces the rule, and keeps it', async () => {
    const wrapper = mountGeneral()
    select(wrapper, 'Codex: Always open in').vm.$emit('update:modelValue', 'terminal')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.settings-opening-note').text()).toContain(
      'Every Codex session opens in Terminal',
    )
    const stored = JSON.parse(localStorage.getItem('valkama-settings') ?? '{}')
    expect(stored.sessions.codex.always).toBe('terminal')
  })

  it('validates an empty custom command beside the field', async () => {
    const wrapper = mountGeneral()
    select(wrapper, 'Claude Code: Always open in').vm.$emit('update:modelValue', 'custom')
    await wrapper.vm.$nextTick()
    expect(wrapper.getComponent(VTextInput).props('error')).toBe(
      'Enter a command before selecting it.',
    )
  })

  it('shows what an older build stored, translated', () => {
    localStorage.setItem(
      'valkama-settings',
      JSON.stringify({ openers: { claude: { kind: 'cursor', command: '' } } }),
    )
    const wrapper = mountGeneral()
    expect(select(wrapper, `Claude Code: ${FALLBACK}`).props('modelValue')).toBe('cursor')
  })
})
