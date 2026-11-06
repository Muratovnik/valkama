/**
 * The words of a list an agent puts under its comment: the person ticks what it offers and
 * sends the ticks at one press, and nobody waits on it.
 */
export const commentListMessages = {
  en: {
    list: {
      send: 'Send marks',
      note: 'Comment on the marks',
      youTicked: 'You ticked {n} of {total}',
      ticked: 'Ticked {n} of {total}',
      change: 'Change',
      cancelAsked: 'Discard the change to these marks?',
      changing:
        'Changing the marks. Until they are saved, the agent still has the ones it was given.',
      discardChange: 'Discard change to these marks',
      frozen: 'The task is closed: marks would reach no one. Reopen the task to tick them.',
    },
  },
  ru: {
    list: {
      send: 'Отправить отметки',
      note: 'Комментарий к отметкам',
      youTicked: 'Вы отметили {n} из {total}',
      ticked: 'Отмечено {n} из {total}',
      change: 'Изменить',
      cancelAsked: 'Отменить изменение отметок?',
      changing: 'Вы меняете отметки. Пока изменение не сохранено, у агента остаются прежние.',
      discardChange: 'Отменить изменение отметок',
      frozen: 'Задача закрыта: отметки не дошли бы ни до кого. Откройте задачу, чтобы отметить.',
    },
  },
}
