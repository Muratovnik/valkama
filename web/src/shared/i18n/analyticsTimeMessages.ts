/**
 * The time of the Analytics page: how a step of a period is named — a day, an hour, a minute —
 * and how a chart says it is cut by them; what the live period «Now» says of itself in the bar:
 * that it reads itself again, and how often; and what its minutes say: which have no data yet,
 * and that their figures are an estimate. Joined into the page's own messages as `analytics.time`.
 */
export const analyticsTimeMessages = {
  en: {
    steps: {
      day: { per: 'per day', name: 'Day' },
      hour: { per: 'per hour', name: 'Hour' },
      minute: { per: 'per minute', name: 'Minute' },
    },
    seconds: '{count}\u{A0}s',
    live: 'Live, every {interval}',
    notYet: 'No data yet',
    estimate:
      'Figures per minute are an estimate: each stretch of work is shared out among the minutes it spans by its time in each.',
  },
  ru: {
    steps: {
      day: { per: 'по дням', name: 'День' },
      hour: { per: 'по часам', name: 'Час' },
      minute: { per: 'по минутам', name: 'Минута' },
    },
    seconds: '{count}\u{A0}с',
    live: 'В реальном времени, каждые {interval}',
    notYet: 'Данных ещё нет',
    estimate:
      'Цифры по минутам — оценка: каждый отрезок работы делится между минутами, которые он захватывает, по времени в каждой.',
  },
} as const
