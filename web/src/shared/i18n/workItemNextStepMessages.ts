/**
 * The first step of a card's checklist not done yet, on its first screen, and the way to
 * the rest of the list. The place is the step's place in the list, not a count of what is
 * done: the third step may be next with only the first of the others closed.
 */
export const workItemNextStepMessages = {
  en: {
    nextStep: {
      label: 'Next step',
      place: '{at} of {total}',
      all: 'All steps',
    },
  },
  ru: {
    nextStep: {
      label: 'Следующий шаг',
      place: '{at} из {total}',
      all: 'Все шаги',
    },
  },
} as const
