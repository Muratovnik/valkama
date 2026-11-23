/**
 * The rail of the Analytics page: what each section's tile says beside its name, and what its
 * share bars say in words to a reader who cannot see them. Its trend says what the page's
 * figures say of theirs (`analytics.figures.trend`). An account's figure before that is not known
 * is said shorter than the table and the cards say it (`unplaced`): beside the overview's total,
 * the whole phrase cut «6 h» at 1440px. `analyticsMessages` holds these under `analytics.rail`.
 */
export const analyticsRailMessages = {
  en: {
    values: '{count} value | {count} values',
    noData: 'No data',
    failed: 'Could not be loaded',
    from: '↑ from {before}',
    unread: 'Nothing to compare with',
    unplaced: 'Not known before',
    shares: 'Shares of {measure}: {parts}',
    rest: 'the rest',
  },
  ru: {
    values: '{count} значение | {count} значения | {count} значений',
    noData: 'Нет данных',
    failed: 'Не удалось загрузить',
    from: '↑ с {before}',
    unread: 'Не с чем сравнить',
    unplaced: 'Раньше не определён',
    shares: 'Доли, {measure}: {parts}',
    rest: 'остальное',
  },
} as const
