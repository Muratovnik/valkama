/**
 * The words of a question's record that do not depend on its kind: the step an answer that cannot
 * be taken back asks with, putting a question off, a question its task's
 * closing took away, and accepting what is recommended in several blocks at once.
 */
export const questionRecordMessages = {
  en: {
    record: {
      asked: '«{answer}» — are you sure?',
      laterName: 'When to come back to the question',
      putOff: 'Put off',
      untilPast: 'Choose today or a later day.',
      withdrawn: 'Question withdrawn: {reference} was closed',
      acceptAll: 'Accept recommended in all',
      acceptN: 'Accept {n}',
      left: 'Not in the list: {n}, with no recommendation that answers them.',
      sent: 'Sent: {sent} of {total}.',
      sentPart: 'Sent: {sent} of {total}. Not sent: {failed}; the reason is in each question.',
    },
  },
  ru: {
    record: {
      asked: '«{answer}» — точно?',
      laterName: 'Когда вернуться к вопросу',
      putOff: 'Отложить',
      untilPast: 'Выберите сегодняшний или более поздний день.',
      withdrawn: 'Вопрос снят: {reference} закрыта',
      acceptAll: 'Принять рекомендованное во всех',
      acceptN: 'Принять {n}',
      left: 'Не вошли: {n} — нет рекомендации, которая на них отвечает.',
      sent: 'Отправлено: {sent} из {total}.',
      sentPart: 'Отправлено: {sent} из {total}. Не ушло: {failed}; причина — в каждом вопросе.',
    },
  },
}
