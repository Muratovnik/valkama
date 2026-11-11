/**
 * The rail of the Analytics page: what each section's tile says beside its name, and what its
 * small charts say in words to a reader who cannot see them. `analyticsMessages` holds these
 * under `analytics.rail`.
 */
export const analyticsRailMessages = {
  en: {
    values: '{count} value | {count} values',
    noData: 'No data',
    failed: 'Could not be read',
    reading: 'Reading…',
    from: '↑ from {before}',
    unread: 'Nothing to compare with',
    trend: '{measure} per day from {from} to {to}: highest {top} ({day}), last {last}',
    trendNone: '{measure} per day: {figure}',
    shares: 'Shares of {measure}: {parts}',
    rest: 'the rest',
  },
  ru: {
    values: '{count} значение | {count} значения | {count} значений',
    noData: 'Нет данных',
    failed: 'Не удалось прочитать',
    reading: 'Читается…',
    from: '↑ с {before}',
    unread: 'Не с чем сравнить',
    trend: '{measure} по дням с {from} по {to}: наибольшее {top} ({day}), последнее {last}',
    trendNone: '{measure} по дням: {figure}',
    shares: 'Доли, {measure}: {parts}',
    rest: 'остальное',
  },
} as const
