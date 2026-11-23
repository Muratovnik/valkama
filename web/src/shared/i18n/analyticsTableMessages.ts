/**
 * The table a section of the Analytics page shows its values in, beside the period before, and
 * its download. Merged into the page's own words as `analytics.table`.
 */
export const analyticsTableMessages = {
  en: {
    title: 'Spending {by}',
    crossTitle: 'Spending {by} and {across}',
    change: 'Change',
    unread: 'The period before was not loaded, so this table shows this period alone.',
    download: 'Download CSV',
    nothingToDownload: 'Nothing to download: this view holds no value.',
    moved: {
      up: '↑ {change}',
      down: '↓ {change}',
      same: 'The same',
      none: 'Nothing before',
      unplaced: 'Account not known before',
      absent: {
        tokens: {
          before: 'No tokens before',
          now: 'No tokens now',
          both: 'No tokens in either',
        },
        cost: {
          before: 'No price before',
          now: 'No price now',
          both: 'No price in either',
        },
      },
    },
  },
  ru: {
    title: 'Расход {by}',
    crossTitle: 'Расход {by} и {across}',
    change: 'Изменение',
    unread: 'Предыдущий период не загружен, поэтому таблица показывает только этот период.',
    download: 'Скачать CSV',
    nothingToDownload: 'Нет данных для скачивания: в этом виде нет значений.',
    moved: {
      up: '↑ {change}',
      down: '↓ {change}',
      same: 'Столько же',
      none: 'Ранее ничего',
      unplaced: 'Ранее неизвестен',
      absent: {
        tokens: {
          before: 'Ранее без токенов',
          now: 'Без токенов',
          both: 'Оба без токенов',
        },
        cost: {
          before: 'Ранее без цены',
          now: 'Без цены',
          both: 'Оба без цены',
        },
      },
    },
  },
} as const
