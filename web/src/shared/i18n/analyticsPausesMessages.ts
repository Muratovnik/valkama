/**
 * The pauses before model requests on the Analytics page: its section on the rail and its panel.
 * The section's heading is its name on the rail, and its rail entry says what it shows (`tile`)
 * where the others show figures. What a pause is, what the shares are of, what «cold» and the
 * background's column mean, that a person's waits are the control sample and that the filters
 * do not apply are said once, in the section's «ⓘ»
 * (`about`), each a sentence of its own; a table says only its figures. A bucket is named by
 * its span (`buckets`), keyed by the answer's bucket key with its punctuation taken out.
 * `analyticsMessages` holds these under `analytics.pauses`.
 */
export const analyticsPausesMessages = {
  en: {
    section: 'Pauses',
    tile: 'Cache after a pause',
    failed: 'The pauses before model requests could not be loaded.',
    failedAgain: 'The pauses could not be loaded again, so these are from the read before.',
    reading: 'Reading the transcripts: {read} of {total} runs.',
    none: 'No model request followed a pause in this period. Choose a longer period.',
    noPeriod: 'The period has no end yet. Choose its last day.',
    waits: {
      label: 'What the pause waited on',
      machine: 'Machine',
      person: 'Person',
      wake: 'Wakes',
    },
    noneFor: {
      machine: 'No request followed a machine wait in this period.',
      person: 'No request followed a person in this period.',
      wake: 'No keep-warm wake ran in this period.',
    },
    about: {
      pause: 'A pause runs from one request being sent to the next one in the same run.',
      shares: 'Read is the share of the context read from the cache; written, written again.',
      cold: 'A request is cold when it read less than half of its context from the cache.',
      background:
        'Cold in background: cold requests sent during background work; Codex does not tell it.',
      person: 'Waits for a person are never warmed: they are the control sample.',
      wake: 'Wakes are requests a keep-warm hook started; their cost is what warming cost.',
      period: 'The period applies, in whole hours; the filters do not.',
      cost: 'A cost is an estimate at API prices, not a bill.',
    },
    environment: '{client} · {role} · {model} · {auth}',
    clients: { claude: 'Claude Code', codex: 'Codex' },
    roles: { main: 'main session', subagent: 'subagent' },
    auth: { subscription: 'subscription', unknown: 'sign-in not known' },
    noModel: 'model not known',
    table: '{environment}, by pause',
    heads: {
      pause: 'Pause',
      requests: 'Requests',
      read: 'Read',
      written: 'Written',
      cold: 'Cold',
      background: 'Cold in background',
      cost: 'Cost',
    },
    buckets: {
      m0: '< 4 min',
      m4: '4–5 min',
      m5: '5–6 min',
      m6: '6–30 min',
      m30: '30–60 min',
      m60: '60–70 min',
      m70: '70 min–3 h',
      h3: '3–12 h',
      h12: '≥ 12 h',
    },
    total: 'All pauses',
  },
  ru: {
    section: 'Паузы',
    tile: 'Кэш после паузы',
    failed: 'Не удалось загрузить паузы перед запросами к модели.',
    failedAgain: 'Не удалось загрузить паузы заново, поэтому показаны прежние.',
    reading: 'Читаю транскрипты: {read} из {total} прогонов.',
    none: 'В этом периоде ни один запрос к модели не шёл после паузы. Выберите период длиннее.',
    noPeriod: 'У периода ещё нет конца. Выберите его последний день.',
    waits: {
      label: 'Чего ждала пауза',
      machine: 'Машина',
      person: 'Человек',
      wake: 'Разбудки',
    },
    noneFor: {
      machine: 'В этом периоде ни один запрос не шёл после ожидания машины.',
      person: 'В этом периоде ни один запрос не шёл после ожидания человека.',
      wake: 'В этом периоде не было ни одной разбудки для прогрева.',
    },
    about: {
      pause: 'Пауза — время от отправки одного запроса до следующего в том же прогоне.',
      shares: 'Из кэша — доля контекста, прочитанная из кэша; в кэш — доля, записанная заново.',
      cold: 'Запрос холодный, если прочитал из кэша меньше половины своего контекста.',
      background: 'Холодные при фоне — отправленные во время фоновой работы; Codex её не сообщает.',
      person: 'Ожидания человека не греются: это контрольная выборка.',
      wake: 'Разбудки — запросы, начатые хуком прогрева; их цена и есть цена прогрева.',
      period: 'Период действует, целыми часами; фильтры — нет.',
      cost: 'Цена — оценка по ценам API, а не счёт.',
    },
    environment: '{client} · {role} · {model} · {auth}',
    clients: { claude: 'Claude Code', codex: 'Codex' },
    roles: { main: 'основная сессия', subagent: 'субагент' },
    auth: { subscription: 'подписка', unknown: 'вход не известен' },
    noModel: 'модель не известна',
    table: '{environment}, по паузам',
    heads: {
      pause: 'Пауза',
      requests: 'Запросы',
      read: 'Из кэша',
      written: 'В кэш',
      cold: 'Холодные',
      background: 'Холодные при фоне',
      cost: 'Цена',
    },
    buckets: {
      m0: '< 4 мин',
      m4: '4–5 мин',
      m5: '5–6 мин',
      m6: '6–30 мин',
      m30: '30–60 мин',
      m60: '60–70 мин',
      m70: '70 мин–3 ч',
      h3: '3–12 ч',
      h12: '≥ 12 ч',
    },
    total: 'Все паузы',
  },
} as const
