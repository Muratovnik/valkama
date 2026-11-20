/**
 * What the card a reference shows on hover says beyond its marks: the lines it
 * prints when there is no item to show, and the sentences a screen reader hears
 * in place of the card, which it does not see. An item that is not there is
 * said in the words a press on it uses (`textLinks.notFound`).
 */
export const workItemPreviewMessages = {
  en: {
    preview: {
      failed: 'Could not read the work item.',
      unavailable: "The work item's store is unavailable right now.",
      held: 'Held by {holder}',
      steps: 'Conditions: {done} of {total}',
      updated: 'Updated {date}',
      closed: 'Closed {date}',
      space: 'Space {space}',
    },
  },
  ru: {
    preview: {
      failed: 'Не удалось прочитать задачу.',
      unavailable: 'Хранилище задачи сейчас недоступно.',
      held: 'Держит {holder}',
      steps: 'Условия: {done} из {total}',
      updated: 'Обновлена {date}',
      closed: 'Закрыта {date}',
      space: 'Пространство {space}',
    },
  },
} as const
