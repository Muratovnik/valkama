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
      sectionIntro: {
        general: 'Local preferences for this device.',
        diagnostics: 'Checks the whole installation, regardless of the selected project.',
      },
      interface: 'Interface',
      system: 'System',
      interfaceIntro: 'Language and other local display preferences.',
      languageHint: 'Applies to the entire Valkama interface on this device.',
      executionTab: {
        label: 'Execution tab on a card: start an agent right from the task',
        hint: 'Off by default. Starting an agent is not cancelled by this: the card just does not offer it.',
        on: 'On',
        off: 'Off',
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
      sectionIntro: {
        general: 'Локальные параметры этого устройства.',
        diagnostics: 'Проверка всей установки, независимо от выбранного проекта.',
      },
      interface: 'Интерфейс',
      system: 'Система',
      interfaceIntro: 'Язык и другие локальные параметры отображения.',
      languageHint: 'Применяется ко всему интерфейсу Valkama на этом устройстве.',
      executionTab: {
        label: 'Вкладка «Исполнение» в карточке: запуск агента прямо из задачи',
        hint: 'По умолчанию выключена. Сам запуск при этом не отменяется, он лишь не предлагается в карточке.',
        on: 'Включена',
        off: 'Выключена',
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
