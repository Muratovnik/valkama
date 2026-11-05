/**
 * What a work item's priority means, for a person who chooses it or reads it.
 *
 * Priority is how much an item matters, not when to do it: the order of work
 * is the item's rank. The four meanings are the ones the server's tool schema
 * gives, so an agent and a person read the same definition.
 */
export const priorityMessages = {
  en: {
    priorityMeaning: {
      hint: '{priority} — {meaning}',
      meaning: {
        urgent: 'blocks work or loses data',
        high: 'serious; could block work',
        medium: 'noticeably affects work, with a workaround',
        low: 'minor',
      },
    },
  },
  ru: {
    priorityMeaning: {
      hint: '{priority} — {meaning}',
      meaning: {
        urgent: 'блокирует работу или теряет данные',
        high: 'серьёзно, может заблокировать',
        medium: 'заметно влияет, есть обход',
        low: 'мелочь',
      },
    },
  },
} as const
