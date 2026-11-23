/**
 * The words of the way through «Needs my answer»: which waiting block of questions is being
 * read and how many wait, the steps to the one before and after, what was put aside, and the
 * line of a space whose stack waits for a triage review past its thresholds, with the way to
 * that space's board narrowed to the stack's cards no review has marked.
 */
export const requestHubMessages = {
  en: {
    hub: {
      nav: 'Question navigation',
      place: 'Question {n} of {m}',
      toAnswer: 'Go to its answer',
      previous: 'Previous question',
      next: 'Next question',
      answered: 'Answered ({count})',
      triageDue: 'Time to triage · {space}: {count} awaiting triage, the oldest for {age}',
      triageShow: 'Show findings',
      triageShowOf: 'Show findings of {space}',
    },
  },
  ru: {
    hub: {
      nav: 'Навигация по вопросам',
      place: 'Вопрос {n} из {m}',
      toAnswer: 'Перейти к ответу',
      previous: 'Предыдущий вопрос',
      next: 'Следующий вопрос',
      answered: 'Отвечено ({count})',
      triageDue: 'Пора разобрать · {space}: ждут разбора {count}, старшая\u{A0}— {age}',
      triageShow: 'Показать находки',
      triageShowOf: 'Показать находки пространства {space}',
    },
  },
}
