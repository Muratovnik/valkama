/**
 * The Analytics page: what agent work was spent on in a period, and how that changed from the
 * period before. A cost is always said to be an estimate at API prices and never a bill.
 */
export const analyticsMessages = {
  en: {
    analytics: {
      title: 'Usage of agent work',
      failed: 'The usage of agent work could not be read.',
      empty: {
        title: 'Nothing was spent in this period',
        description:
          'No agent work was recorded in this period with these filters. Choose a longer period or clear a filter.',
      },
      period: {
        label: 'Period',
        week: 'This week',
        weeks4: 'Past 4 weeks',
        custom: 'Custom',
        from: 'From',
        to: 'To',
        reversed: 'The last day comes before the first.',
        incomplete: 'Choose the first and the last day of the period.',
      },
      by: 'Break down by',
      dimensions: {
        account: 'Account',
        project: 'Project',
        work_item: 'Task',
        executor: 'Executor',
        role: 'Role',
        launch_class: 'Launch class',
        model: 'Model',
        effort: 'Effort',
        environment: 'Environment',
      },
      roles: {
        main: 'Main agent',
        subagent: 'Subagent',
        advisor: 'Adviser',
      },
      values: {
        none: 'No task',
        unknown: 'Unknown',
        deleted: 'Deleted task',
      },
      filters: {
        title: 'Filters',
        titleCount: 'Filters · {count}',
        any: 'Any',
        clear: 'Clear filters',
        remove: 'Remove {label}',
        reading: 'Reading the values…',
        failed: 'The values could not be read.',
        noMatches: 'No matches',
      },
    },
  },
  ru: {
    analytics: {
      title: 'Расход работы агентов',
      failed: 'Не удалось прочитать расход работы агентов.',
      empty: {
        title: 'За этот период ничего не потрачено',
        description:
          'За этот период с этими фильтрами работа агентов не записана. Выберите период длиннее или снимите фильтр.',
      },
      period: {
        label: 'Период',
        week: 'Эта неделя',
        weeks4: 'Последние 4 недели',
        custom: 'Свой',
        from: 'С',
        to: 'По',
        reversed: 'Последний день стоит раньше первого.',
        incomplete: 'Выберите первый и последний день периода.',
      },
      by: 'В разрезе',
      dimensions: {
        account: 'Аккаунт',
        project: 'Проект',
        work_item: 'Задача',
        executor: 'Исполнитель',
        role: 'Роль',
        launch_class: 'Способ запуска',
        model: 'Модель',
        effort: 'Усилие',
        environment: 'Среда',
      },
      roles: {
        main: 'Основной агент',
        subagent: 'Субагент',
        advisor: 'Советник',
      },
      values: {
        none: 'Без задачи',
        unknown: 'Неизвестно',
        deleted: 'Удалённая задача',
      },
      filters: {
        title: 'Фильтры',
        titleCount: 'Фильтры · {count}',
        any: 'Любое',
        clear: 'Снять фильтры',
        remove: 'Убрать {label}',
        reading: 'Читаю значения…',
        failed: 'Не удалось прочитать значения.',
        noMatches: 'Ничего не найдено',
      },
    },
  },
} as const
