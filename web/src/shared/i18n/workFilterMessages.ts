/**
 * The Work filter: one field of text and facet chips, the menu of conditions
 * and facet values it opens, and the counts that answer it.
 *
 * The counts answer the filter instead of describing the population: «319
 * открытых из 1267» with nothing picked, «42 из 319 открытых» once something
 * is. The held count rides its condition in the menu, so the line does not
 * carry a third number.
 *
 * «Из 319 открытых» takes its form from the open count, so what matched is
 * `{matched}`, never `{count}`: vue-i18n picks the form from a numeric named
 * `count` before the plural argument, and prints the plural argument in place
 * of a `count` of 0 — «319 из 319» for a filter that matched nothing.
 */
export const workFilterMessages = {
  en: {
    filter: {
      label: 'Filter work',
      placeholder: 'Filter: reference, title…',
      // Where the field is too narrow for the whole hint, a phone's bar.
      placeholderShort: 'Filter',
      clearText: 'Clear the text',
      menuLabel: 'Facets to filter by',
      facets: 'Filter by',
      back: '{facet}: back to the facets',
      everywhere: {
        group: 'All projects',
        row: 'Search for “{text}” in all projects',
      },
      labelsMatch: {
        all: {
          text: 'all',
          name: 'Labels: all of those picked',
          title: 'Work that carries every label picked',
          join: 'and',
        },
        any: {
          text: 'any',
          name: 'Labels: any of those picked',
          title: 'Work that carries at least one of the labels picked',
          join: 'or',
        },
      },
      // The filters ready-made, over «Filter by»: a condition is a point of a card's acceptance.
      conditions: 'Filters',
      // «Closed in a period»: its periods in the menu, its chip, and its days' fields.
      closedIn: {
        name: 'Closed in a period',
        today: 'Today',
        week: 'This week',
        weeks4: 'Past 4 weeks',
        custom: 'Days of my own',
        chip: {
          today: 'Closed today',
          week: 'Closed this week',
          weeks4: 'Closed in 4 weeks',
          custom: 'Closed on my days',
        },
        from: 'Closed from',
        to: 'Closed to',
        reversed: 'The last day comes before the first.',
      },
      tokens: 'Picked facets',
      facet: {
        category: 'State',
        kind: 'Kind',
        priority: 'Priority',
        labels: 'Label',
        holder: 'Assignee',
        project: 'Project',
        goal: 'Goal or stage',
      },
      noProject: 'No project',
      chip: '{facet}: {value}',
      chipNot: '{facet}: not {value}',
      negate: 'Is not: {name}',
      excluded: '{value}, excluded',
      remove: 'Remove from filter: {name}',
      open: '{open} open of {total}',
      matched: '{matched} of {open} open',
      closedToo: '{closed} closed match | {closed} closed matches',
      elsewhere: 'and {count} from other spaces',
      reset: 'Reset',
      incomplete: 'The filter is too long for the address: a reload keeps only part of it.',
      empty: 'No work matches this filter.',
      emptyHint: 'Reset the filter to see all the work again.',
      resetAll: 'Reset the filter',
    },
  },
  ru: {
    filter: {
      label: 'Фильтр работы',
      placeholder: 'Фильтр: номер, название…',
      placeholderShort: 'Фильтр',
      clearText: 'Очистить текст',
      menuLabel: 'Признаки для фильтра',
      facets: 'Фильтр по признаку',
      back: '{facet}: назад к признакам',
      everywhere: {
        group: 'Все проекты',
        row: 'Искать «{text}» во всех проектах',
      },
      labelsMatch: {
        all: {
          text: 'все',
          name: 'Метки: все отмеченные',
          title: 'Задачи, на которых есть каждая отмеченная метка',
          join: 'и',
        },
        any: {
          text: 'любая',
          name: 'Метки: любая из отмеченных',
          title: 'Задачи, на которых есть хотя бы одна из отмеченных меток',
          join: 'или',
        },
      },
      conditions: 'Фильтры',
      closedIn: {
        name: 'Закрыто за период',
        today: 'Сегодня',
        week: 'Эта неделя',
        weeks4: '4 недели',
        custom: 'Свои дни',
        chip: {
          today: 'Закрыто сегодня',
          week: 'Закрыто на этой неделе',
          weeks4: 'Закрыто за 4 недели',
          custom: 'Закрыто за свои дни',
        },
        from: 'Закрыто с',
        to: 'Закрыто по',
        reversed: 'Последний день стоит раньше первого.',
      },
      tokens: 'Выбранные признаки',
      facet: {
        category: 'Состояние',
        kind: 'Тип',
        priority: 'Приоритет',
        labels: 'Метка',
        holder: 'Исполнитель',
        project: 'Проект',
        goal: 'Цель или этап',
      },
      noProject: 'Без проекта',
      chip: '{facet}: {value}',
      chipNot: '{facet}: не {value}',
      negate: 'Не равно: {name}',
      excluded: '{value}, исключено',
      remove: 'Убрать из фильтра: {name}',
      open: '{open}\u{A0}открытая из {total} | {open}\u{A0}открытые из {total} | {open}\u{A0}открытых из {total}',
      matched:
        '{matched} из {open}\u{A0}открытой | {matched} из {open}\u{A0}открытых | {matched} из {open}\u{A0}открытых',
      closedToo:
        'есть {closed}\u{A0}закрытая | есть {closed}\u{A0}закрытые | есть {closed}\u{A0}закрытых',
      elsewhere: 'и {count} из других пространств',
      reset: 'Сбросить',
      incomplete:
        'Фильтр не поместился в адрес целиком: после перезагрузки сохранится только часть.',
      empty: 'Под этот фильтр не подходит ни одна работа.',
      emptyHint: 'Сбросьте фильтр, чтобы снова увидеть всю работу.',
      resetAll: 'Сбросить фильтр',
    },
  },
} as const
