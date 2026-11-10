/**
 * The Analytics page: where the usage of agent work is read. Until usage is collected the
 * page says so, in words that promise nothing it does not yet show.
 */
export const analyticsMessages = {
  en: {
    analytics: {
      title: 'Usage of agent work',
      empty: {
        title: 'No usage collected yet',
        description:
          'Time, tokens and an estimated API cost of agent work will appear here once Valkama collects them.',
      },
    },
  },
  ru: {
    analytics: {
      title: 'Расход работы агентов',
      empty: {
        title: 'Расход ещё не собран',
        description:
          'Время, токены и оценка стоимости по ценам API для работы агентов появятся здесь, когда Valkama начнёт их собирать.',
      },
    },
  },
} as const
