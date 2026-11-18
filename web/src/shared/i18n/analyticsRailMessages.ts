/**
 * The rail of the Analytics page: what each section's tile says beside its name, and what its
 * share bars say in words to a reader who cannot see them. Its trend says what the page's
 * figures say of theirs (`analytics.figures.trend`). `analyticsMessages` holds these under
 * `analytics.rail`.
 */
export const analyticsRailMessages = {
  en: {
    values: '{count} value | {count} values',
    noData: 'No data',
    failed: 'Could not be loaded',
    from: '↑ from {before}',
    unread: 'Nothing to compare with',
    shares: 'Shares of {measure}: {parts}',
    rest: 'the rest',
  },
  ru: {
    values: '{count} значение | {count} значения | {count} значений',
    noData: 'Нет данных',
    failed: 'Не удалось загрузить',
    from: '↑ с {before}',
    unread: 'Не с чем сравнить',
    shares: 'Доли, {measure}: {parts}',
    rest: 'остальное',
  },
} as const
