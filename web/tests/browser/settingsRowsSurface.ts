/**
 * The harness page for the scoped settings row (`SettingsScopedRow`) and the scope above it
 * (`SettingsScopeChoice`), in the module frame Settings stands in: the scope with a space
 * chosen and with all spaces, then a row in each state — shared, inheriting, own, refused —
 * with each kind of choice a row draws, and the set no row agrees with.
 */
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsScopeChoice from '@/pages/settings/components/SettingsScopeChoice.vue'
import SettingsScopedRow from '@/pages/settings/components/SettingsScopedRow.vue'

import ModuleFrame from '@/widgets/module-frame/components/ModuleFrame.vue'

import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

type Decider = 'agent' | 'human'
type Preset = 'minimal' | 'default' | 'maximal' | 'manual'

/** What the row hands its slot. */
interface Choice<Value> {
  names: Record<string, string | undefined>
  value: Value | null
  update: (value: Value) => void
}

const DECIDERS = [
  { value: 'agent' as const, label: 'Агент' },
  { value: 'human' as const, label: 'Человек' },
]
const PRESETS = [
  { value: 'minimal' as const, label: 'Минимальное' },
  { value: 'default' as const, label: 'По умолчанию' },
  { value: 'maximal' as const, label: 'Максимальное' },
  { value: 'manual' as const, label: 'Ручная работа' },
]
const deciderWords = (value: Decider) =>
  DECIDERS.find((decider) => decider.value === value)?.label ?? value

/** Where a row's own value lives: the surface's state, written back as the row asks. */
function held<Value>(own: Ref<Value | null>) {
  return {
    'own': own.value,
    'onUpdate:own': (next: Value | null) => {
      own.value = next
    },
  }
}

function deciderRow(row: {
  label: string
  name: string
  own: Ref<Decider | null>
  scope: 'global' | 'space'
  failure?: string
}) {
  const human = (row.own.value ?? 'human') === 'human'
  return h(
    SettingsScopedRow<Decider>,
    {
      ...held(row.own),
      'data-row': row.name,
      'label': row.label,
      'hint': human ? 'Решает человек: находка ждёт его ответа.' : 'Решает агент и пишет, почему.',
      'scope': row.scope,
      'inherited': row.scope === 'space' ? 'human' : undefined,
      'failure': row.failure,
      'wordsOf': deciderWords,
    },
    {
      default: ({ names, update, value }: Choice<Decider>) =>
        h(SegmentedControl<Decider>, {
          ...names,
          'label': row.label,
          'modelValue': value,
          'options': DECIDERS,
          'onUpdate:modelValue': update,
        }),
    },
  )
}

export const SettingsRowsSurface = defineComponent({
  setup() {
    const scope = ref<'global' | 'space'>('space')
    const shared = ref<Decider | null>('human')
    const inheriting = ref<Decider | null>(null)
    const owning = ref<Decider | null>('agent')
    const refused = ref<Decider | null>('agent')
    const queue = ref<boolean | null>(true)
    const days = ref<number | null>(10)
    const preset = ref<Preset | null>(null)

    const presetRow = () =>
      h(
        SettingsScopedRow<Preset>,
        {
          ...held(preset),
          'data-row': 'preset',
          'label': 'Набор',
          'hint': 'Свой набор: отличается в 2 строках',
          'scope': 'global',
        },
        {
          default: ({ names, update, value }: Choice<Preset>) =>
            h(SegmentedControl<Preset>, {
              ...names,
              'class': 'settings-rows-presets',
              'label': 'Набор',
              'modelValue': value,
              'options': PRESETS,
              'onUpdate:modelValue': update,
            }),
        },
      )

    const switchRow = () =>
      h(
        SettingsScopedRow<boolean>,
        {
          ...held(queue),
          'data-row': 'switch',
          'label': 'Агенты берут работу из очереди',
          'hint': 'Агент сам берёт следующую готовую работу.',
          'scope': 'space',
          'inherited': false,
          'wordsOf': (on: boolean) => (on ? 'Включено' : 'Выключено'),
        },
        {
          default: ({ names, update, value }: Choice<boolean>) =>
            h(ToggleSwitch, {
              ...names,
              'label': 'Агенты берут работу из очереди',
              'modelValue': value === true,
              'onLabel': 'Включено',
              'offLabel': 'Выключено',
              'onUpdate:modelValue': update,
            }),
        },
      )

    const numberRow = () =>
      h(
        SettingsScopedRow<number>,
        {
          ...held(days),
          'data-row': 'number',
          'label': 'Напоминать о разборе: находке старше',
          'hint': 'Находка старше 10 дней попадёт в напоминание.',
          'scope': 'space',
          'inherited': 14,
          'wordsOf': (count: number) => `${count} дней`,
        },
        {
          default: ({ names, value }: Choice<number>) =>
            h(VTextInput, {
              class: 'settings-rows-days',
              label: 'Напоминать о разборе: находке старше',
              describedby: names['aria-describedby'],
              hideLabel: true,
              min: '1',
              modelValue: String(value),
              type: 'number',
            }),
        },
      )

    return () =>
      h(ModuleFrame, { module: 'settings', label: 'Настройки' }, () =>
        h('div', { class: 'settings-rows-sheet' }, [
          h(SettingsScopeChoice, {
            'data-row': 'scope-space',
            'space': 'ALPHA',
            'modelValue': scope.value,
            'onUpdate:modelValue': (next: 'global' | 'space') => {
              scope.value = next
            },
          }),
          h(SettingsScopeChoice, { 'data-row': 'scope-all', 'space': null }),
          presetRow(),
          h(SettingsGroup, { title: 'Кто решает' }, () => [
            deciderRow({
              name: 'shared',
              label: 'Находка вне цели: делать или нет',
              scope: 'global',
              own: shared,
            }),
            deciderRow({
              name: 'inheriting',
              label: 'Цель, которую агент предложил сам',
              scope: 'space',
              own: inheriting,
            }),
            deciderRow({
              name: 'own',
              label: 'Отмена цели, этапа или задачи, над которыми работают другие',
              scope: 'space',
              own: owning,
            }),
            deciderRow({
              name: 'refused',
              label: 'Закрытие цели',
              scope: 'space',
              own: refused,
              failure: 'Не сохранено: сервер не ответил.',
            }),
          ]),
          h(SettingsGroup, { title: 'Очередь и сроки' }, () => [switchRow(), numberRow()]),
        ]),
      )
  },
})
