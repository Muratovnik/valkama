import { defineComponent, h, onMounted, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SettingsScopeChoice from '@/pages/settings/components/SettingsScopeChoice.vue'
import SettingsScopedRow from '@/pages/settings/components/SettingsScopedRow.vue'
import { useStoredRecord } from '@/pages/settings/composables/useStoredRecord.ts'
import { presetOf } from '@/pages/settings/utils/settingPresets.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type Decider = 'agent' | 'human'
interface RowProps {
  own: Decider | null
  scope: 'global' | 'space'
  inherited?: Decider
}

const LABEL = 'An aside found outside the goal'
const HINT = 'A person decides whether to do it.'
const WORDS: Record<Decider, string> = { agent: 'Agent', human: 'Human' }
const DECIDERS = (['agent', 'human'] as const).map((value) => ({ value, label: WORDS[value] }))

function i18nIn(locale = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })
}

/** The «Agent | Human» choice a host draws in the row's slot, wired as the row asks. */
function deciderChoice(scope: {
  names: Record<string, string | undefined>
  value: unknown
  update: (value: Decider) => void
}) {
  return h(SegmentedControl<Decider>, {
    ...scope.names,
    'label': LABEL,
    'modelValue': scope.value as Decider | null,
    'options': DECIDERS,
    'onUpdate:modelValue': scope.update,
  })
}

function mountRow(props: Partial<RowProps>) {
  return mount(SettingsScopedRow<Decider>, {
    props: {
      label: LABEL,
      hint: HINT,
      scope: 'space',
      own: null,
      wordsOf: (value: Decider) => WORDS[value],
      ...props,
    },
    slots: { default: deciderChoice },
    global: { plugins: [i18nIn()] },
    attachTo: document.body,
  })
}

const checkedRadios = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[role="radio"][aria-checked="true"]').map((radio) => radio.text())

enableAutoUnmount(afterEach)

describe('SettingsScopedRow', () => {
  it('is a plain setting in the shared scope: the choice, named by the label and described by the hint', () => {
    const wrapper = mountRow({ scope: 'global', own: 'agent' })

    expect(wrapper.find('[role="switch"]').exists()).toBe(false)
    expect(checkedRadios(wrapper)).toEqual(['Agent'])
    const group = wrapper.get('[role="radiogroup"]')
    const labelId = group.attributes('aria-labelledby') ?? ''
    const hintId = group.attributes('aria-describedby') ?? ''
    expect(wrapper.get(`[id="${labelId}"]`).text()).toBe(LABEL)
    expect(wrapper.get(`[id="${hintId}"]`).text()).toBe(HINT)
    expect(wrapper.text()).not.toContain('own')
  })

  it('says the shared value in words and draws no choice while a space inherits it', () => {
    const wrapper = mountRow({ inherited: 'human', own: null })

    const toggle = wrapper.get('[role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe(`Own value: ${LABEL}`)
    expect(toggle.text()).toBe('Own value')
    expect(wrapper.text()).toContain('Shared: Human')
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    expect(wrapper.find('.settings-scoped-mark').exists()).toBe(false)
  })

  it('switching to an own value starts it from the shared one', async () => {
    const wrapper = mountRow({ inherited: 'human', own: null })

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('update:own')).toEqual([['human']])
  })

  it('shows an own value as the choice, the switch on and a quiet «own» at the name', async () => {
    const wrapper = mountRow({ inherited: 'human', own: 'agent' })

    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(checkedRadios(wrapper)).toEqual(['Agent'])
    expect(wrapper.get('.settings-row-label').text()).toBe(`${LABEL} own`)
    expect(wrapper.text()).toContain('Shared: Human')

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click')
    expect(wrapper.emitted('update:own')).toEqual([['human']])
  })

  it('goes back to the shared value by switching the own value off, with no second control for it', async () => {
    const wrapper = mountRow({ inherited: 'human', own: 'agent' })
    // The switch and the choice's two segments, and nothing that resets.
    expect(wrapper.findAll('button')).toHaveLength(3)

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('update:own')).toEqual([[null]])
  })

  it('in Russian names its parts in Russian', () => {
    const wrapper = mount(SettingsScopedRow<Decider>, {
      props: { label: LABEL, hint: HINT, scope: 'space', inherited: 'human', own: 'agent' },
      global: { plugins: [i18nIn('ru')] },
    })
    expect(wrapper.get('[role="switch"]').text()).toBe('Своё значение')
    expect(wrapper.get('.settings-scoped-mark').text()).toBe('своё')
    expect(wrapper.text()).toContain('Общее: human')
  })
})

describe('SettingsScopedRow over the stored record', () => {
  type Record = { decides: Decider | null }

  /** A host as the page will be: the row over `useStoredRecord`, its write held by the test. */
  function mountStored() {
    const writes: Record[] = []
    const answers: { reject: (error: Error) => void; resolve: (kept: Record) => void }[] = []
    const Host = defineComponent({
      setup() {
        const stored = useStoredRecord<Record, 'decides'>({
          read: () => Promise.resolve({ decides: 'agent' }),
          write: (record) => {
            writes.push(record)
            return new Promise<Record>((resolve, reject) => {
              answers.push({ resolve, reject })
            })
          },
          failureText: (error) => (error as Error).message,
        })
        onMounted(stored.load)
        return () =>
          stored.record.value &&
          h(
            SettingsScopedRow<Decider>,
            {
              'label': LABEL,
              'hint': HINT,
              'scope': 'space',
              'inherited': 'human',
              'own': stored.record.value.decides,
              'failure': stored.failureOf('decides'),
              'wordsOf': (value: Decider) => WORDS[value],
              'onUpdate:own': (decides: Decider | null) => {
                stored.put('decides', { decides })
              },
            },
            { default: deciderChoice },
          )
      },
    })
    const wrapper = mount(Host, { global: { plugins: [i18nIn()] }, attachTo: document.body })
    return { wrapper, writes, answers }
  }

  it('takes a refused change back to the confirmed value, says why under the row and keeps the focus on the choice', async () => {
    const { wrapper, writes, answers } = mountStored()
    await flushPromises()
    const agent = wrapper.get<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
    agent.element.focus()

    await agent.trigger('keydown', { key: 'ArrowRight' })
    expect(writes).toEqual([{ decides: 'human' }])
    expect(checkedRadios(wrapper)).toEqual(['Human'])
    // The write is out and nothing is disabled, so the keyboard keeps its place.
    expect(wrapper.findAll<HTMLButtonElement>('button').every((b) => !b.element.disabled)).toBe(
      true,
    )

    answers[0]?.reject(new Error('the listener is gone'))
    await flushPromises()

    expect(checkedRadios(wrapper)).toEqual(['Agent'])
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('the listener is gone')
    const group = wrapper.get('[role="radiogroup"]').element
    expect(group.compareDocumentPosition(alert.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(group.contains(document.activeElement)).toBe(true)
  })

  it('writes the way back to the shared value as one record, and a refusal keeps the own one', async () => {
    const { wrapper, writes, answers } = mountStored()
    await flushPromises()

    await wrapper.get('[role="switch"]').trigger('click')
    expect(writes).toEqual([{ decides: null }])
    expect(wrapper.text()).toContain('Shared: Human')
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)

    answers[0]?.reject(new Error('refused'))
    await flushPromises()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(checkedRadios(wrapper)).toEqual(['Agent'])
    expect(wrapper.get('[role="alert"]').text()).toBe('refused')
  })

  it('a confirmed change clears the reason the last one gave', async () => {
    const { wrapper, answers } = mountStored()
    await flushPromises()
    await wrapper.get('[role="switch"]').trigger('click')
    answers[0]?.reject(new Error('refused'))
    await flushPromises()

    await wrapper.get('[role="switch"]').trigger('click')
    answers[1]?.resolve({ decides: null })
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })
})

describe('the preset row', () => {
  type Preset = 'minimal' | 'default' | 'maximal' | 'manual'
  const PRESETS: Record<Preset, Record<string, Decider>> = {
    minimal: { aside: 'agent', goal: 'agent', task: 'agent' },
    default: { aside: 'human', goal: 'human', task: 'agent' },
    maximal: { aside: 'human', goal: 'agent', task: 'agent' },
    manual: { aside: 'human', goal: 'human', task: 'human' },
  }
  const NAMES: Record<Preset, string> = {
    minimal: 'Minimal',
    default: 'Default',
    maximal: 'Maximal',
    manual: 'Manual work',
  }

  function mountPresets(values: Record<string, Decider>, locale = 'en') {
    const i18n = i18nIn(locale)
    const { preset, differing } = presetOf(values, PRESETS)
    const hint =
      preset === null
        ? i18n.global.t('settings.scoped.customSet', { count: differing }, differing)
        : `The ${NAMES[preset]} set.`
    return mount(SettingsScopedRow<Preset>, {
      props: { label: 'Set', hint, scope: 'global', own: preset },
      slots: {
        default: (scope: {
          names: Record<string, string | undefined>
          value: Preset | null
          update: (value: Preset) => void
        }) =>
          h(SegmentedControl<Preset>, {
            ...scope.names,
            'label': 'Set',
            'modelValue': scope.value,
            'options': (Object.keys(NAMES) as Preset[]).map((value) => ({
              value,
              label: NAMES[value],
            })),
            'onUpdate:modelValue': scope.update,
          }),
      },
      global: { plugins: [i18n] },
    })
  }

  it('chooses no set when the rows match none, says how far they are from the nearest, and offers no «Custom» segment', async () => {
    const wrapper = mountPresets({ aside: 'agent', goal: 'human', task: 'human' })

    expect(checkedRadios(wrapper)).toEqual([])
    expect(wrapper.findAll('[role="radio"]').map((radio) => radio.text())).toEqual([
      'Minimal',
      'Default',
      'Maximal',
      'Manual work',
    ])
    expect(wrapper.get('.settings-row-hint').text()).toBe('Custom set: differs in 1 row')

    await wrapper.findAll('[role="radio"]')[0]?.trigger('click')
    expect(wrapper.emitted('update:own')).toEqual([['minimal']])
  })

  it.each([
    ['en', { aside: 'agent', goal: 'human', task: 'human' }, 'Custom set: differs in 1 row'],
    [
      'en',
      { aside: 'agent', goal: 'human', task: 'agent', more: 'x' },
      'Custom set: differs in 1 row',
    ],
    ['ru', { aside: 'agent', goal: 'human', task: 'human' }, 'Свой набор: отличается в 1 строке'],
  ] as const)('says the custom set in %s for %j', (locale, values, words) => {
    const wrapper = mountPresets(values as Record<string, Decider>, locale)
    expect(wrapper.get('.settings-row-hint').text()).toBe(words)
  })

  it('chooses the set the rows are', () => {
    const wrapper = mountPresets({ aside: 'human', goal: 'human', task: 'agent' })
    expect(checkedRadios(wrapper)).toEqual(['Default'])
    expect(wrapper.get('.settings-row-hint').text()).toBe('The Default set.')
  })
})

describe('presetOf', () => {
  const PRESETS = {
    agents: { a: 'agent', b: 'agent', c: 'agent', d: 'agent' },
    people: { a: 'human', b: 'human', c: 'human', d: 'human' },
  }

  it('counts the settings that differ from the nearest preset', () => {
    expect(presetOf({ a: 'human', b: 'human', c: 'agent', d: 'agent' }, PRESETS)).toEqual({
      preset: null,
      differing: 2,
    })
    expect(presetOf({ a: 'human', b: 'human', c: 'human', d: 'agent' }, PRESETS)).toEqual({
      preset: null,
      differing: 1,
    })
    expect(presetOf({ a: 'human', b: 'human', c: 'human', d: 'human' }, PRESETS)).toEqual({
      preset: 'people',
      differing: 0,
    })
  })

  it('counts a setting the group lacks as differing', () => {
    expect(presetOf({ a: 'agent', b: 'agent', c: 'agent' }, PRESETS)).toEqual({
      preset: null,
      differing: 1,
    })
  })
})

function mountScope(space: string | null) {
  const scope = ref<'global' | 'space'>()
  const wrapper = mount(SettingsScopeChoice, {
    props: {
      space,
      'onUpdate:modelValue': (next: 'global' | 'space') => {
        scope.value = next
        void wrapper.setProps({ modelValue: next })
      },
    },
    global: { plugins: [i18nIn()] },
  })
  return { wrapper, scope }
}

describe('SettingsScopeChoice', () => {
  it('offers the shared values and the space chosen in the context bar, and starts on the space', async () => {
    const { wrapper, scope } = mountScope('ALPHA')

    expect(wrapper.findAll('[role="radio"]').map((radio) => radio.text())).toEqual([
      'Shared values',
      'Space ALPHA',
    ])
    expect(checkedRadios(wrapper)).toEqual(['Space ALPHA'])
    expect(wrapper.text()).not.toContain('choose it at the top')

    await wrapper.findAll('[role="radio"]')[0]?.trigger('click')
    expect(scope.value).toBe('global')
    expect(checkedRadios(wrapper)).toEqual(['Shared values'])
  })

  it('with all spaces in the context bar has one segment and says where a space is chosen', () => {
    const { wrapper } = mountScope(null)

    expect(wrapper.findAll('[role="radio"]').map((radio) => radio.text())).toEqual([
      'Shared values',
    ])
    expect(checkedRadios(wrapper)).toEqual(['Shared values'])
    const note = wrapper.get('.settings-scope-note')
    expect(note.text()).toBe('To set a space’s values, choose it at the top.')
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-describedby')).toBe(
      note.attributes('id'),
    )
  })
})
