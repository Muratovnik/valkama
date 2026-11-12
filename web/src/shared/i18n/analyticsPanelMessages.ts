/**
 * The panel of one dimension on the Analytics page: a small chart per value on one scale, and the
 * table under it that sorts, crosses the dimension with a second one and splits tokens by kind.
 * Merged into the page's own words as `analytics.panel`.
 */
export const analyticsPanelMessages = {
  en: {
    bars: {
      more: '{count} more — in the table | {count} more — in the table',
    },
    multiples: {
      title: '{measure} {per} of each, {by}',
      scale: 'Every chart from 0 to',
      period: 'Whole period',
    },
    table: {
      across: 'Cross with',
      acrossNone: 'No second dimension',
      expand: 'Expand table',
      collapse: 'Collapse table',
      crossTitle: '{measure} {by} and {across}',
      total: 'Total',
      heads: {
        time: 'Agent time',
        tokens: 'Tokens',
        cost: 'Est. cost, API prices',
        before: 'Before, {period}',
      },
      counts: {
        now: '{count} in the period',
        before: '{count} only before',
        apart: 'and {names}',
      },
      sorted: 'sorted by «{column}», {direction}',
      sortBy: 'Sort by «{column}»',
      direction: {
        down: 'largest first',
        up: 'smallest first',
        az: 'A to Z',
        za: 'Z to A',
      },
      reading: 'Reading the breakdown {across}…',
      failed: 'The breakdown {across} could not be read.',
      kinds: {
        note: 'Tokens count input, output and cache writes; cache reads stand apart, and reasoning is part of output.',
        input: 'Input',
        cached_read: 'Cache read',
        cache_write_5m: 'Cache write, 5 min',
        cache_write_1h: 'Cache write, 1 h',
        output: 'Output',
        reasoning: 'Of it reasoning',
      },
    },
  },
  ru: {
    bars: {
      more: 'ещё {count} — в таблице | ещё {count} — в таблице | ещё {count} — в таблице',
    },
    multiples: {
      title: '{measure} {per} у каждого, {by}',
      scale: 'Шкала всех графиков: от 0 до',
      period: 'Весь период',
    },
    table: {
      across: 'В разрезе по',
      acrossNone: 'Без второго измерения',
      expand: 'Развернуть таблицу',
      collapse: 'Свернуть таблицу',
      crossTitle: '{measure} {by} и {across}',
      total: 'Итого',
      heads: {
        time: 'Время агентов',
        tokens: 'Токены',
        cost: 'Оценка по ценам API',
        before: 'Ранее, {period}',
      },
      counts: {
        now: '{count} в периоде',
        before: '{count} только в прошлом',
        apart: 'и {names}',
      },
      sorted: 'по столбцу «{column}», {direction}',
      sortBy: 'Упорядочить по столбцу «{column}»',
      direction: {
        down: 'сначала большие',
        up: 'сначала малые',
        az: 'от А до Я',
        za: 'от Я до А',
      },
      reading: 'Читается разрез {across}…',
      failed: 'Разрез {across} не прочитан.',
      kinds: {
        note: 'Токены — это вход, выход и запись в кэш; чтение кэша стоит отдельно, а рассуждения входят в выход.',
        input: 'Вход',
        cached_read: 'Чтение кэша',
        cache_write_5m: 'Запись в кэш, 5 мин',
        cache_write_1h: 'Запись в кэш, 1 ч',
        output: 'Выход',
        reasoning: 'Из него рассуждения',
      },
    },
  },
} as const
