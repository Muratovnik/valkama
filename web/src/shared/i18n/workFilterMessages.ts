/**
 * The Work filter: one field of text and facet chips, its two presets, the
 * menu of facet values it opens, and the counts that answer it.
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
      placeholder: 'Reference, title, label…',
      // Where the field is too narrow for the whole hint, a phone's bar.
      placeholderShort: 'Search, filter',
      clearText: 'Clear the text',
      menuLabel: 'Facets to filter by',
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
      closedToo: '{closed} closed match | {closed} closed matches',
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
      placeholder: 'Номер, название, метка…',
      placeholderShort: 'Поиск, фильтр',
      clearText: 'Очистить текст',
      menuLabel: 'Признаки для фильтра',
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
      open: '{open}\u{A0}открытая из {total} | {open}\u{A0}открытые из {total} | {open}\u{A0}открытых из {total}',
      matched:
        '{matched} из {open}\u{A0}открытой | {matched} из {open}\u{A0}открытых | {matched} из {open}\u{A0}открытых',
      closedToo:
        'есть {closed}\u{A0}закрытая | есть {closed}\u{A0}закрытые | есть {closed}\u{A0}закрытых',
      reset: 'Сбросить',
      incomplete:
        'Фильтр не поместился в адрес целиком: после перезагрузки сохранится только часть.',
      empty: 'Под этот фильтр не подходит ни одна работа.',
      emptyHint: 'Сбросьте фильтр, чтобы снова увидеть всю работу.',
      resetAll: 'Сбросить фильтр',
    },
  },
} as const
