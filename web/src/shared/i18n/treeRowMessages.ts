/**
 * The words of a tree's rows: the arrow that folds a row, named by the row it
 * folds; a path row, which stands only for what the filter let through under
 * it; and the parent of a row deeper than the indent goes.
 */
export const treeRowMessages = {
  en: {
    tree: {
      fold: 'Fold {name}',
      unfold: 'Unfold {name}',
      path: 'Shown as a path: does not match the filter itself',
      matching: '{count} match | {count} matches',
      under: 'in {reference}',
    },
  },
  ru: {
    tree: {
      fold: 'Свернуть {name}',
      unfold: 'Раскрыть {name}',
      path: 'Показана как путь: сама под фильтр не подходит',
      matching: 'подходит {count} | подходят {count} | подходят {count}',
      under: 'в {reference}',
    },
  },
} as const
