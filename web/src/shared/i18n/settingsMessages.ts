/* The copy of the Settings page itself; its groups with their own file keep their words there. */

import { kindColorMessages } from '@/shared/i18n/kindColorMessages.ts'

export const settingsMessages = {
  en: {
    settings: {
      title: 'Valkama settings',
      sectionLabel: 'Settings section',
      section: {
        general: 'General',
        diagnostics: 'Diagnostics',
      },
      interface: 'Interface',
      system: 'System',
      languageHint: 'Applies to the entire Valkama interface on this device.',
      executionTab: {
        label: 'Execution tab on a card: start an agent right from the task',
        hint: 'Off by default. Starting an agent is not cancelled by this: the card just does not offer it.',
        on: 'On',
        off: 'Off',
      },
      stateNames: {
        label: 'State names',
        hint: 'The standard workflow states, unrenamed, read in the interface language. Agents and the API always see the workflow names.',
        translated: 'Translated',
        workflow: 'As in the workflow',
      },
      kindColors: kindColorMessages.en,
      searchOptions: 'Search options',
      noOptions: 'No matching options',
      diagnostics: {
        needsAttention: 'Needs attention',
        passed: 'Passed checks',
      },
    },
  },
  ru: {
    settings: {
      title: 'Настройки Valkama',
      sectionLabel: 'Раздел настроек',
      section: {
        general: 'Общие',
        diagnostics: 'Диагностика',
      },
      interface: 'Интерфейс',
      system: 'Система',
      languageHint: 'Применяется ко всему интерфейсу Valkama на этом устройстве.',
      executionTab: {
        label: 'Вкладка «Исполнение» в карточке: запуск агента прямо из задачи',
        hint: 'По умолчанию выключена. Сам запуск при этом не отменяется, он лишь не предлагается в карточке.',
        on: 'Включена',
        off: 'Выключена',
      },
      stateNames: {
        label: 'Названия состояний',
        hint: 'Стандартные состояния процесса, если их не переименовали, читаются на языке интерфейса. Агенты и API всегда видят названия из процесса.',
        translated: 'Перевод',
        workflow: 'Как в процессе',
      },
      kindColors: kindColorMessages.ru,
      searchOptions: 'Поиск по вариантам',
      noOptions: 'Подходящих вариантов нет',
      diagnostics: {
        needsAttention: 'Требует внимания',
        passed: 'Успешные проверки',
      },
    },
  },
} as const
