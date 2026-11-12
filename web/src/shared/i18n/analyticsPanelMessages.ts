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
      title: '{measure} {per}, separately {by}',
      heading: {
        day: 'Per day, {by}',
        hour: 'Per hour, {by}',
        minute: 'Per minute, {by}',
      },
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
        outside: '{count} outside the period',
        values: {
          account: '{count} account | {count} accounts',
          project: '{count} project | {count} projects',
          work_item: '{count} task | {count} tasks',
          executor: '{count} executor | {count} executors',
          role: '{count} role | {count} roles',
          launch_class: '{count} launch class | {count} launch classes',
          model: '{count} model | {count} models',
          effort: '{count} effort level | {count} effort levels',
          environment: '{count} environment | {count} environments',
        },
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
      title: '{measure} {per}, отдельно {by}',
      heading: {
        day: 'По дням, {by}',
        hour: 'По часам, {by}',
        minute: 'По минутам, {by}',
      },
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
        outside: '{count} вне периода',
        values: {
          account: '{count} аккаунт | {count} аккаунта | {count} аккаунтов',
          project: '{count} проект | {count} проекта | {count} проектов',
          work_item: '{count} задача | {count} задачи | {count} задач',
          executor: '{count} исполнитель | {count} исполнителя | {count} исполнителей',
          role: '{count} роль | {count} роли | {count} ролей',
          launch_class:
            '{count} способ запуска | {count} способа запуска | {count} способов запуска',
          model: '{count} модель | {count} модели | {count} моделей',
          effort: '{count} усилие | {count} усилия | {count} усилий',
          environment: '{count} среда | {count} среды | {count} сред',
        },
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
