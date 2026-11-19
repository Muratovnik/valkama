/**
 * The Analytics page's three figures: what a figure absent from the read is called, what the
 * tokens count and leave apart, what its small trend says in words, and what an hour of agent
 * time took of the tokens and the cost. That the time of agents working at once adds up, so a
 * period's agent time may be longer than the period (`timeNote`), is said in the section's «ⓘ».
 * `analyticsMessages` holds these under `analytics.figures`.
 */
export const analyticsFigureMessages = {
  en: {
    noTokens: 'No tokens',
    noPrice: 'No price',
    costNote: 'The cost is an estimate at API list prices, not a bill.',
    timeNote:
      'Agent time adds up agents working at once: two agents for an hour each make 2\u{A0}h.',
    unpriced: '{count} token without a price | {count} tokens without a price',
    anew: 'Processed anew: {kinds}',
    kinds: {
      input: 'input {count}',
      output: 'output {count}',
      cacheWrites: 'cache writes {count}',
    },
    cacheReads: 'Cache reads: {count}',
    trend: '{measure} {per} from {from} to {to}: highest {top} ({day}), last {last}',
    trendNone: '{measure} {per}: {figure}',
    withShare: '{figure} · {share}',
    perHour: {
      cost: '${now}/h',
      costWas: '${now}/h, was {was}',
      costDetail: 'An estimate at API prices of an hour of agent time',
      tokens: '{now}/h',
      tokensWas: '{now}/h, was {was}',
      tokensDetail: 'Tokens processed anew in an hour of agent time',
    },
  },
  ru: {
    noTokens: 'Нет токенов',
    noPrice: 'Нет цены',
    costNote: 'Стоимость — оценка по прейскуранту API, а не счёт.',
    timeNote:
      'Время агентов, работающих одновременно, складывается: два агента по часу — 2\u{A0}ч.',
    unpriced:
      '{count}\u{A0}токен без цены | {count}\u{A0}токена без цены | {count}\u{A0}токенов без цены',
    anew: 'Обработано заново: {kinds}',
    kinds: {
      input: 'вход {count}',
      output: 'выход {count}',
      cacheWrites: 'запись в кэш {count}',
    },
    cacheReads: 'Чтение кэша: {count}',
    trend: '{measure} {per} с {from} по {to}: наибольшее {top} ({day}), последнее {last}',
    trendNone: '{measure} {per}: {figure}',
    withShare: '{figure} · {share}',
    perHour: {
      cost: '{now}\u{A0}$/ч',
      costWas: '{now}\u{A0}$/ч, было {was}',
      costDetail: 'Оценка по ценам API на час работы агентов',
      tokens: '{now}/ч',
      tokensWas: '{now}/ч, было {was}',
      tokensDetail: 'Токены, обработанные заново, на час работы агентов',
    },
  },
} as const
