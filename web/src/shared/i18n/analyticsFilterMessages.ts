/**
 * The filter bar of the Analytics page: the shared facet filter's words for the usage's
 * dimensions, its chips and what it says when a value cannot be read or added.
 * `analyticsMessages` holds these under `analytics.filters`.
 */
export const analyticsFilterMessages = {
  en: {
    label: 'Filter the usage',
    short: 'Filter',
    menu: 'Dimensions to filter by',
    dimensions: 'Filter by',
    back: '{dimension}: back to the dimensions',
    clearText: 'Clear the text',
    chips: 'Filters set',
    clear: 'Clear filters',
    remove: 'Remove {label}',
    failed: 'The values could not be loaded.',
    noMatches: 'No matches',
    full: 'The link to this view cannot hold more values of the {dimension} filter, so this one was not added.',
    add: 'Add to filter',
    held: 'Already in filter',
  },
  ru: {
    label: 'Фильтр расхода',
    short: 'Фильтр',
    menu: 'Измерения для фильтра',
    dimensions: 'Фильтровать по',
    back: '{dimension}: назад к измерениям',
    clearText: 'Очистить текст',
    chips: 'Заданные фильтры',
    clear: 'Снять фильтры',
    remove: 'Убрать {label}',
    failed: 'Не удалось загрузить значения.',
    noMatches: 'Ничего не найдено',
    full: 'Ссылка на этот вид не вмещает больше значений фильтра «{dimension}», поэтому это значение не добавлено.',
    add: 'Добавить в фильтр',
    held: 'Уже в фильтре',
  },
} as const
