/* How much work an item took: its line on the card, the Agents tab and the work a goal holds. */

export const workItemUsageMessages = {
  en: {
    usage: {
      work: 'Work',
      workTree: 'Work with its contents',
      allAgents: 'All agents',
      cost: 'Cost',
      tokensLabel: 'Tokens',
      tokens: '{count} token | {count} tokens',
      noData: 'no data',
      noPrice: 'no price',
      onTheSide: 'on the side',
      lineMeaning:
        'Work is the time on the clock: waiting for a script counts, waiting for a person or a computer that was off does not.',
      lineAgents: 'All agents together: {time}.',
      lineChildren: 'With the work of its items.',
      lineDetails: 'Details are on the Agents tab.',
      parallel:
        'Agents worked in parallel: Work is the time on the clock, All agents adds up what each of them spent.',
      costNote:
        'The cost is an estimate at API prices and not a bill: a subscription is priced differently.',
      estimated:
        'The time is an estimate: history is rebuilt from transcripts, with no live ticks behind it.',
      mixed:
        'Part of the time is an estimate: {part} of {whole} is rebuilt from transcripts, with no live ticks behind it.',
      unpriced: 'The cost is incomplete: no price for {models}.',
      unknownCost: 'The cost is unknown: no price for {models}.',
      processedNote: 'Input, cache writes and output. Reads from the cache are counted apart.',
      ownRun: 'The session itself',
      wholeSession: 'Whole session',
      noItem: 'No task',
      failed: 'Could not read how much work this took.',
      rootOwn: 'Its own work',
      accounts: 'By organization',
      accountUnknown: 'Unknown organization',
      accountShare: '{share} of the time',
      accountStart: 'From the start',
      accountChanges: 'Where the organization changed',
      inAnalytics: 'Open in Analytics',
      inAnalyticsOwn: 'Open its own work in Analytics',
      roles: 'Who did the work',
      role: { main: 'Main agent', subagent: 'Subagent', advisor: 'Adviser' },
      classNone: 'no launch class',
      classUnknown: 'launch class unknown',
      sessions: 'Sessions',
      sessionsNote:
        'Every session that spent on the work or wrote to it, each once. Sessions that only spent on it count too, so this can be more than the sessions the card lists.',
      quota: 'Weekly quota',
      quotaWeek: 'week to {date}',
      quotaPercent: '≈\u{A0}{percent} of the week',
      quotaShare:
        'Its share of the account’s cost that week, {share}, times the {used} of the week spent.',
      quotaNoReading: 'No reading of this week says how much of it is spent.',
      quotaNoCost: 'The account’s work that week had no cost.',
      quotaNote:
        'Assumes a quota is spent in proportion to the API price, which no published formula confirms. It leans high: the week’s percent holds work no stretch here records.',
      quotaUnknown: '≈\u{A0}{share} of its cost is on no account that can be shown.',
    },
  },
  ru: {
    usage: {
      work: 'Работа',
      workTree: 'Работа вместе с составом',
      allAgents: 'Агенты вместе',
      cost: 'Стоимость',
      tokensLabel: 'Токены',
      tokens: '{count}\u{A0}токен | {count}\u{A0}токена | {count}\u{A0}токенов',
      noData: 'нет данных',
      noPrice: 'нет цены',
      onTheSide: 'попутно',
      lineMeaning:
        'Работа — время по часам: ожидание скриптов входит, ожидание человека и выключенный компьютер не входят.',
      lineAgents: 'Агенты вместе: {time}.',
      lineChildren: 'Вместе с работой над составом.',
      lineDetails: 'Подробности на вкладке «Агенты».',
      parallel:
        'Агенты работали параллельно: «Работа» — время по часам, «Агенты вместе» — сумма времени каждого.',
      costNote: 'Стоимость — оценка по ценам API, а не счёт: подписка оплачивается иначе.',
      estimated:
        'Время — оценка: история восстановлена из транскриптов, живых отметок времени за ней нет.',
      mixed:
        'Часть времени — оценка: {part} из {whole} восстановлено из транскриптов, живых отметок времени за этим нет.',
      unpriced: 'Стоимость неполная: нет цены у {models}.',
      unknownCost: 'Стоимость неизвестна: нет цены у {models}.',
      processedNote: 'Ввод, запись в кэш и вывод. Чтение из кэша считается отдельно.',
      ownRun: 'Сама сессия',
      wholeSession: 'Вся сессия',
      noItem: 'Без задачи',
      failed: 'Не удалось прочитать, сколько заняла работа.',
      rootOwn: 'Своя работа',
      accounts: 'По организациям',
      accountUnknown: 'Неизвестная организация',
      accountShare: '{share} времени',
      accountStart: 'С начала',
      accountChanges: 'Где сменилась организация',
      inAnalytics: 'Открыть в аналитике',
      inAnalyticsOwn: 'Открыть в аналитике свою работу',
      roles: 'Кто работал',
      role: { main: 'Основной агент', subagent: 'Субагент', advisor: 'Советник' },
      classNone: 'без класса запуска',
      classUnknown: 'класс запуска неизвестен',
      sessions: 'Сессии',
      sessionsNote:
        'Каждая сессия, которая тратила на работу или писала в неё, по одному разу. Считаются и сессии, которые только тратили, поэтому число может быть больше списка сессий в карточке.',
      quota: 'Недельная квота',
      quotaWeek: 'неделя до {date}',
      quotaPercent: '≈\u{A0}{percent} недели',
      quotaShare:
        'Её доля в цене работы аккаунта за неделю, {share}, умноженная на израсходованные {used} недели.',
      quotaNoReading: 'Ни одно чтение этой недели не говорит, сколько её израсходовано.',
      quotaNoCost: 'Работа аккаунта на этой неделе ничего не стоила.',
      quotaNote:
        'Считается, что квота тратится пропорционально цене по API; опубликованной формулы, которая это подтверждает, нет. Число завышено: процент недели включает работу, которой здесь нет.',
      quotaUnknown:
        '≈\u{A0}{share} её цены приходится на работу без аккаунта, который можно показать.',
    },
  },
}
