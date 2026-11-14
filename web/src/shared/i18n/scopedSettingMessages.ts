/* The words of a setting that holds a shared value and a space's own one. */

export const scopedSettingMessages = {
  en: {
    own: 'Own value',
    ownName: 'Own value: {label}',
    ownMark: 'own',
    shared: 'Shared: {value}',
    scope: {
      label: 'Scope',
      global: 'Shared values',
      space: 'Space {space}',
      pickSpace: 'To set a space’s values, choose it at the top.',
    },
    customSet: 'Custom set: differs in {count} row | Custom set: differs in {count} rows',
  },
  ru: {
    own: 'Своё значение',
    ownName: 'Своё значение: {label}',
    ownMark: 'своё',
    shared: 'Общее: {value}',
    scope: {
      label: 'Область',
      global: 'Общие значения',
      space: 'Пространство {space}',
      pickSpace: 'Чтобы задать значения пространства, выберите его вверху.',
    },
    customSet:
      'Свой набор: отличается в {count} строке | Свой набор: отличается в {count} строках | Свой набор: отличается в {count} строках',
  },
}
