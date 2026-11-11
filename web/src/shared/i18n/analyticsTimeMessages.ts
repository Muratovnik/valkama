/**
 * The time of the Analytics page: how a step of a period is named — a day, an hour, a minute —
 * and how a chart says it is cut by them. Joined into the page's own messages as
 * `analytics.time`.
 */
export const analyticsTimeMessages = {
  en: {
    steps: {
      day: { per: 'per day', name: 'Day' },
      hour: { per: 'per hour', name: 'Hour' },
      minute: { per: 'per minute', name: 'Minute' },
    },
  },
  ru: {
    steps: {
      day: { per: 'по дням', name: 'День' },
      hour: { per: 'по часам', name: 'Час' },
      minute: { per: 'по минутам', name: 'Минута' },
    },
  },
} as const
