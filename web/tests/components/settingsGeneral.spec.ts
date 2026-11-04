import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsGeneral from '@/pages/settings/components/SettingsGeneral.vue'

import { OPEN_PLACES } from '@/shared/api/openPlanModel.ts'
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

/** What `GET /api/open-places` says: everything is installed but what is named. */
function answerPlaces(missing: string[] = [], status = 200) {
  const places = Object.fromEntries(OPEN_PLACES.map((place) => [place, !missing.includes(place)]))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ places }), { status })),
  )
}

describe('SettingsGeneral opening sessions and files', () => {
  beforeEach(() => {
    localStorage.clear()
    answerPlaces()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('offers each family only the places that can hold its sessions', () => {
    const wrapper = mountGeneral()
    expect(wrapper.find('.settings-group-intro').exists()).toBe(true)
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

  it('does not offer what is not installed, and says what a chosen one comes to', async () => {
    answerPlaces(['cursor'])
    localStorage.setItem(
      'valkama-settings',
      JSON.stringify({ sessions: { codex: { fallback: 'cursor', always: '', command: '' } } }),
    )
    const wrapper = mountGeneral()
    await flushPromises()
    expect(values(wrapper, `Claude Code: ${FALLBACK}`)).not.toContain('cursor')
    expect(values(wrapper, 'Editor for files')).toEqual(['vscode', 'vscode-insiders', 'windsurf'])
    expect(values(wrapper, `Codex: ${FALLBACK}`)).toContain('cursor')
    expect(wrapper.get('.settings-opening-note').text()).toBe(
      'Cursor is not installed here, so its sessions and files go to VS Code.',
    )
  })

  it('offers every place and says so when what is installed cannot be read', async () => {
    answerPlaces([], 503)
    const wrapper = mountGeneral()
    await flushPromises()
    expect(values(wrapper, 'Editor for files')).toContain('cursor')
    expect(wrapper.get('.settings-opening-unknown').text()).toContain('could not be checked')
  })

  it('says beside the family when a place replaces the rule, and keeps it', async () => {
    const wrapper = mountGeneral()
    select(wrapper, 'Codex: Always open in').vm.$emit('update:modelValue', 'terminal')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.settings-opening-note').text()).toContain(
      'Every Codex session opens in a terminal, wherever it was last open.',
    )
    const stored = JSON.parse(localStorage.getItem('valkama-settings') ?? '{}')
    expect(stored.sessions.codex.always).toBe('terminal')
  })

  it('asks for a custom command only once its field is left empty, and says what holds', async () => {
    const wrapper = mountGeneral()
    select(wrapper, 'Claude Code: Always open in').vm.$emit('update:modelValue', 'custom')
    await wrapper.vm.$nextTick()
    const field = wrapper.getComponent(VTextInput)
    // Saved as chosen: no error before the owner could type, and the row says what a press does.
    expect(field.props('error')).toBe('')
    expect(wrapper.get('.settings-opening-note').text()).toBe(
      'Until there is a command, these sessions do not open.',
    )
    const stored = JSON.parse(localStorage.getItem('valkama-settings') ?? '{}')
    expect(stored.sessions.claude).toMatchObject({ always: 'custom', command: '' })

    await field.get('input').trigger('focusout')
    expect(field.props('error')).toBe('Enter a command to open sessions with.')
    field.vm.$emit('update:modelValue', 'code {cwd}')
    await wrapper.vm.$nextTick()
    expect(field.props('error')).toBe('')
    expect(wrapper.find('.settings-opening-note').exists()).toBe(false)
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
