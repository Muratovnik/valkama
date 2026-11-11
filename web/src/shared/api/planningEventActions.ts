/**
 * Every action a work item's history event can name, as the store's CHECK constraint
 * holds them. A strict reader refuses an event whose action is not here, so the list
 * grows with the store's in the same release.
 */
export const EVENT_ACTIONS = [
  'created',
  'transitioned',
  'claimed',
  'released',
  'taken_over',
  'linked',
  'unlinked',
  'checklist_replaced',
  'checklist_claimed',
  'checklist_taken_over',
  'checklist_released',
  'checklist_completed',
  'checklist_reopened',
  'summarized',
  'execution_attached',
  'request_created',
  'request_answered',
  'request_declined',
  'request_expired',
  'request_changed',
  'comment_resolved',
  'comment_reopened',
  'mentioned',
  'labels_changed',
  'overridden',
] as const

/** The longest detail any event but `labels_changed` carries. */
export const EVENT_DETAIL_MAX = 512
/**
 * The server's bound on a `labels_changed` detail (`model.LABELS_DETAIL_LIMIT`): both sets of
 * 32 labels of 64 characters, every character written as a six-character JSON escape.
 */
export const LABELS_DETAIL_MAX = 24_785
