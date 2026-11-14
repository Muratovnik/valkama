/* The copy of the Settings page itself; its groups with their own file keep their words there. */

import { accountAliasMessages } from '@/shared/i18n/accountAliasMessages.ts'
import { kindColorMessages } from '@/shared/i18n/kindColorMessages.ts'
import { scopedSettingMessages } from '@/shared/i18n/scopedSettingMessages.ts'

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
      quotaPoll: {
        title: 'Subscription quota',
        label: 'Poll the usage endpoint for the quota',
        hint: "Off by default. While on, Valkama asks the usage endpoint for the quota of the account Claude Code is signed in to on this machine, with that sign-in. The endpoint is undocumented, and Anthropic's terms do not explicitly permit this use: switch it on only if you accept that.",
        on: 'On',
        off: 'Off',
        loadFailed: 'Could not read the quota settings.',
        saveFailed: 'Not saved: {reason}',
      },
      kindColors: kindColorMessages.en,
      accountAliases: accountAliasMessages.en,
      scoped: scopedSettingMessages.en,
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
      quotaPoll: {
        title: 'Квота подписки',
        label: 'Опрашивать эндпоинт использования о квоте',
        hint: 'По умолчанию выключено. Когда включено, Valkama запрашивает у эндпоинта использования квоту аккаунта, под которым на этой машине выполнен вход в Claude Code, с этим входом. Эндпоинт не документирован, и условия Anthropic явно не разрешают такое использование: включайте, только если вы с этим согласны.',
        on: 'Включено',
        off: 'Выключено',
        loadFailed: 'Не удалось прочитать настройки квоты.',
        saveFailed: 'Не сохранено: {reason}',
      },
      kindColors: kindColorMessages.ru,
      accountAliases: accountAliasMessages.ru,
      scoped: scopedSettingMessages.ru,
      searchOptions: 'Поиск по вариантам',
      noOptions: 'Подходящих вариантов нет',
      diagnostics: {
        needsAttention: 'Требует внимания',
        passed: 'Успешные проверки',
      },
    },
  },
} as const
