/**
 * The side panel over the Analytics page: one value pressed anywhere on it, every value of a
 * section in its table, or what a quota window went to. Merged into the page's own words as
 * `analytics.detail`.
 */
export const analyticsDetailMessages = {
  en: {
    open: 'Details of {value}',
    label: 'Details: {title}',
    close: 'Close the details',
    resize: 'Resize the details',
    card: 'Open the card',
    full: 'The link to this view cannot hold the details of {value}, so they are not opened.',
    failed: 'The details could not be loaded.',
    empty: 'Nothing was spent on it in this period.',
    figures: 'Figures',
    figuresOf: '{figures} · {period}',
    allTime: 'All time',
    allTimeFailed: 'Could not be read',
    about: 'About these figures',
    share: 'Share of the whole',
    shareOf: '{share} · {measure}',
    days: '{measure} {per}',
    byModel: 'By model',
    byAccount: 'By account',
    all: {
      title: '{dimension}: every value',
      find: 'Find by name',
    },
    window: {
      open: 'Breakdown',
      title: '{window} · {account}',
      missing: 'This window is no longer in the quota.',
    },
  },
  ru: {
    open: 'Подробнее: {value}',
    label: 'Подробности: {title}',
    close: 'Закрыть подробности',
    resize: 'Изменить ширину подробностей',
    card: 'Открыть карточку',
    full: 'Ссылка на этот вид не вмещает подробности «{value}», поэтому они не открыты.',
    failed: 'Не удалось загрузить подробности.',
    empty: 'В этом периоде на него ничего не потрачено.',
    figures: 'Показатели',
    figuresOf: '{figures} · {period}',
    allTime: 'За всё время',
    allTimeFailed: 'Не удалось прочитать',
    about: 'Об этих цифрах',
    share: 'Доля от всего',
    shareOf: '{share} · {measure}',
    days: '{measure} {per}',
    byModel: 'По моделям',
    byAccount: 'По аккаунтам',
    all: {
      title: '{dimension}: все значения',
      find: 'Найти по имени',
    },
    window: {
      open: 'Детализация',
      title: '{window} · {account}',
      missing: 'Этого окна больше нет в квоте.',
    },
  },
} as const
