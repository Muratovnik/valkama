/**
 * The overview of the Analytics page: the period's chart beside the period before, what changed
 * most from it, and the first values of the dimensions a person asks about most. Joined into the
 * page's own messages as `analytics.overview`.
 */
export const analyticsOverviewMessages = {
  en: {
    risenFrom: '↑ from {before} in {period}',
    chartFailed: 'The period by project could not be loaded, so its chart is not drawn.',
    before: { word: 'period before' },
    changes: {
      title: 'What changed',
      label: 'What changed from {period}',
      up: 'Rose most',
      down: 'Fell most',
      still: 'Compared with {period}, no task moved.',
      unread: 'The period before could not be loaded, so nothing is compared.',
      newly: 'Nothing before',
      gone: 'Nothing now',
    },
    cards: {
      label: 'The first values of the period',
      open: 'Open the section',
      failed: 'The values could not be loaded.',
      empty: 'Nothing spent in this period.',
      work_item: 'Tasks',
      model: 'Models',
      role: 'Roles',
      project: 'Projects',
    },
  },
  ru: {
    risenFrom: '↑ с {before} за период {period}',
    chartFailed: 'Не удалось загрузить период по проектам, поэтому график не нарисован.',
    before: { word: 'прошлый период' },
    changes: {
      title: 'Что изменилось',
      label: 'Что изменилось по сравнению с периодом {period}',
      up: 'Выросло сильнее всего',
      down: 'Упало сильнее всего',
      still: 'По сравнению с периодом {period} ни одна задача не изменилась.',
      unread: 'Не удалось загрузить прошлый период, поэтому сравнения нет.',
      newly: 'Раньше ничего',
      gone: 'Сейчас ничего',
    },
    cards: {
      label: 'Первые значения периода',
      open: 'Открыть раздел',
      failed: 'Не удалось загрузить значения.',
      empty: 'За этот период ничего не потрачено.',
      work_item: 'Задачи',
      model: 'Модели',
      role: 'Роли',
      project: 'Проекты',
    },
  },
} as const
