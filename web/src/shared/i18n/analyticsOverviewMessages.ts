/**
 * The overview of the Analytics page: the period's chart beside the period before, what changed
 * most from it, and the first values of the dimensions a person asks about most. Joined into the
 * page's own messages as `analytics.overview`.
 */
export const analyticsOverviewMessages = {
  en: {
    risenFrom: '↑ from {before} in {period}',
    hours: {
      title: '{measure} per hour, {by}',
    },
    before: {
      word: 'period before',
      failed: 'The period before could not be read, so it is not outlined.',
    },
    changes: {
      title: 'What changed',
      label: 'What changed from {period}',
      up: 'Rose most',
      down: 'Fell most',
      still: 'No task moved from {period}.',
      unread: 'The period before could not be read, so nothing is compared.',
      newly: 'nothing before',
      gone: 'nothing now',
    },
    cards: {
      label: 'The first values of the period',
      open: 'Open the section',
      reading: 'Reading the values…',
      failed: 'The values could not be read.',
      empty: 'Nothing spent in this period.',
      work_item: 'Tasks',
      model: 'Models',
      role: 'Roles',
      project: 'Projects',
    },
  },
  ru: {
    risenFrom: '↑ с {before} за период {period}',
    hours: {
      title: '{measure} по часам, {by}',
    },
    before: {
      word: 'прошлый период',
      failed: 'Прошлый период не удалось прочитать, поэтому он не обведён.',
    },
    changes: {
      title: 'Что изменилось',
      label: 'Что изменилось по сравнению с периодом {period}',
      up: 'Выросло сильнее всего',
      down: 'Упало сильнее всего',
      still: 'По сравнению с периодом {period} ни одна задача не изменилась.',
      unread: 'Прошлый период не удалось прочитать, поэтому сравнивать не с чем.',
      newly: 'раньше ничего',
      gone: 'сейчас ничего',
    },
    cards: {
      label: 'Первые значения периода',
      open: 'Открыть раздел',
      reading: 'Читаю значения…',
      failed: 'Не удалось прочитать значения.',
      empty: 'За этот период ничего не потрачено.',
      work_item: 'Задачи',
      model: 'Модели',
      role: 'Роли',
      project: 'Проекты',
    },
  },
} as const
