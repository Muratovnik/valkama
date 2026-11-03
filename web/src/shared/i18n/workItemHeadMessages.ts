/**
 * What a work item's card says in its head: who the item is, what holds for
 * it, and the one thing to do about it — or why there is nothing to do.
 *
 * The state is said once, by the control that moves it. The head used to say
 * it twice, as a fact in a grid and again as a «Перевести в» select a row below.
 */
export const workItemHeadMessages = {
  en: {
    head: {
      updated: 'updated {date}',
      copyReference: 'Copy {reference}',
      referenceCopied: '{reference} copied',
      referenceCopyFailed: 'Could not copy {reference}',
      copyLink: 'Copy link to {reference}',
      linkCopied: 'Link copied',
      linkCopyFailed: 'Could not copy the link',
      state: 'State: {state}. Move to another state',
      epic: 'Epic — take a task from it',
    },
  },
  ru: {
    head: {
      updated: 'обновлено {date}',
      copyReference: 'Скопировать {reference}',
      referenceCopied: '{reference} скопирован',
      referenceCopyFailed: 'Не удалось скопировать {reference}',
      copyLink: 'Копировать ссылку на {reference}',
      linkCopied: 'Ссылка скопирована',
      linkCopyFailed: 'Не удалось скопировать ссылку',
      state: 'Состояние: {state}. Перевести в другое',
      epic: 'Эпик — возьмите задачу из него',
    },
  },
} as const
