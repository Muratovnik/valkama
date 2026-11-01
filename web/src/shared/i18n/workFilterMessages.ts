/**
 * The Work filter: one field of text and facet chips, its two presets, the
 * menu of facet values, and the counts that answer it.
 *
 * The counts answer the filter instead of describing the population: «319
 * открытых из 1267» with nothing picked, «42 из 319 открытых» once something
 * is. The held count rides its preset, so the line does not carry a third
 * number.
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
      placeholder: 'Reference or title',
      // Where the field is too narrow for the whole hint, a phone's bar.
      placeholderShort: 'Search',
      clearText: 'Clear the text',
      menu: 'Filter',
      menuNamed: 'Filter: {count} picked',
      menuLabel: 'Facets to filter by',
      noOptions: 'No value matches “{text}”',
      presets: 'Quick filters',
      tokens: 'Picked facets',
      facet: {
        category: 'State',
        kind: 'Kind',
        priority: 'Priority',
        labels: 'Label',
        holder: 'Holder',
      },
      chip: '{facet}: {value}',
      remove: 'Remove from filter: {name}',
      open: '{open} open of {total}',
      matched: '{matched} of {open} open',
      closedToo: '{count} more closed',
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
      placeholder: 'Номер или название',
      placeholderShort: 'Поиск',
      clearText: 'Очистить текст',
      menu: 'Фильтр',
      menuNamed: 'Фильтр: выбрано {count}',
      menuLabel: 'Признаки для фильтра',
      noOptions: 'Ни одно значение не подходит к «{text}»',
      presets: 'Быстрые фильтры',
      tokens: 'Выбранные признаки',
      facet: {
        category: 'Состояние',
        kind: 'Тип',
        priority: 'Приоритет',
        labels: 'Метка',
        holder: 'Ответственный',
      },
      chip: '{facet}: {value}',
      remove: 'Убрать из фильтра: {name}',
      open: '{open}\u{A0}открытая из {total} | {open}\u{A0}открытых из {total} | {open}\u{A0}открытых из {total}',
      matched:
        '{matched} из {open}\u{A0}открытой | {matched} из {open}\u{A0}открытых | {matched} из {open}\u{A0}открытых',
      closedToo:
        'ещё {count}\u{A0}закрытая | ещё {count}\u{A0}закрытые | ещё {count}\u{A0}закрытых',
      reset: 'Сбросить',
      incomplete:
        'Фильтр не поместился в адрес целиком: после перезагрузки сохранится только часть.',
      empty: 'Под этот фильтр не подходит ни одна работа.',
      emptyHint: 'Сбросьте фильтр, чтобы снова увидеть всю работу.',
      resetAll: 'Сбросить фильтр',
    },
  },
} as const
