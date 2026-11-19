/**
 * How the Analytics page says a value of a dimension where its id is not what a reader reads: work
 * with no value there, a task's several projects, work nobody can place, an account by what tells
 * it apart where the owner gave it no name (`useSpendingWords.seatLabel`), a deleted task and the
 * folded rest.
 * `analyticsMessages` holds these under `analytics.values`.
 */
export const analyticsValueMessages = {
  en: {
    none: {
      work_item: 'No task',
      launch_class: 'The session itself',
      project: 'No project',
      other: 'No value',
    },
    several: 'Several projects',
    unknown: 'Unknown',
    seat: {
      unplaced: '{organization} · account not known',
      weekly: '{organization} · resets {reset}',
      shared: 'may be two accounts',
    },
    deleted: 'Deleted task',
    other: 'Other, {count} more | Other, {count} more',
  },
  ru: {
    none: {
      work_item: 'Без задачи',
      launch_class: 'Сама сессия',
      project: 'Без проекта',
      other: 'Без значения',
    },
    several: 'Несколько проектов',
    unknown: 'Неизвестно',
    seat: {
      unplaced: '{organization} · аккаунт не определён',
      weekly: '{organization} · сброс {reset}',
      shared: 'возможно, два аккаунта',
    },
    deleted: 'Удалённая задача',
    other: 'Остальное, ещё {count} | Остальное, ещё {count} | Остальное, ещё {count}',
  },
}
