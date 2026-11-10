/**
 * The words for a text on another item that named this one: the history's name for the
 * event, whose detail is that text's comment id or its item's description, and the quiet
 * line the discussion shows for each record the read brings. The line names the item the
 * words stand on by its number, which the text layer makes the link to it.
 */
export const mentionMessages = {
  en: {
    activity: {
      mentioned: 'Mentioned in another work item',
    },
    mentions: {
      line: {
        comment: 'Mentioned in a comment on {from}',
        report: 'Mentioned in a work report on {from}',
        summary: 'Mentioned in the task outcome of {from}',
        description: 'Mentioned in the description of {from}',
        deleted: 'Mentioned in a deleted work item',
      },
      older: '{n} older mention not shown | {n} older mentions not shown',
    },
  },
  ru: {
    activity: {
      mentioned: 'Упомянуто в другой задаче',
    },
    mentions: {
      line: {
        comment: 'Упомянута в комментарии {from}',
        report: 'Упомянута в отчёте о работе {from}',
        summary: 'Упомянута в итоге задачи {from}',
        description: 'Упомянута в описании {from}',
        deleted: 'Упомянута в удалённой задаче',
      },
      older:
        'Ещё {n} более раннее упоминание не показано | Ещё {n} более ранних упоминания не показаны | Ещё {n} более ранних упоминаний не показаны',
    },
  },
}
