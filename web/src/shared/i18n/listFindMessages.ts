/**
 * The list's own find: its bar, its count and its steps.
 *
 * The count says which match is current of how many, and says so when there is
 * none; it is the bar's status, so a reader hears each step.
 */
export const listFindMessages = {
  en: {
    find: {
      region: 'Find in the list',
      label: 'Find',
      placeholder: 'Find in the list',
      count: '{at} of {total}',
      none: 'No matches',
      previous: 'Previous match',
      next: 'Next match',
      close: 'Close find',
    },
  },
  ru: {
    find: {
      region: 'Поиск по списку',
      label: 'Найти',
      placeholder: 'Найти в списке',
      count: '{at} из {total}',
      none: 'Нет совпадений',
      previous: 'Предыдущее совпадение',
      next: 'Следующее совпадение',
      close: 'Закрыть поиск',
    },
  },
}
