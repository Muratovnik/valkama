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
    narrow: 'Narrow the page to it',
    full: 'The link to this view cannot hold the details of {value}, so they are not opened.',
    failed: 'The details could not be read.',
    empty: 'Nothing was spent on it in this period.',
    figures: 'Figures',
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
      open: 'Where the window went',
      title: '{window} · {account}',
      about: 'About these figures',
      missing: 'The quota no longer names this window.',
    },
  },
  ru: {
    open: 'Подробнее: {value}',
    label: 'Подробности: {title}',
    close: 'Закрыть подробности',
    resize: 'Изменить ширину подробностей',
    card: 'Открыть карточку',
    narrow: 'Сузить страницу до него',
    full: 'Ссылка на этот вид не вмещает подробности «{value}», поэтому они не открыты.',
    failed: 'Не удалось прочитать подробности.',
    empty: 'В этом периоде на него ничего не потрачено.',
    figures: 'Показатели',
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
      open: 'На что ушло окно',
      title: '{window} · {account}',
      about: 'Об этих цифрах',
      missing: 'Квота больше не называет это окно.',
    },
  },
} as const
