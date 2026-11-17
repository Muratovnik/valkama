/**
 * Every point an agent's own decision can be marked with on the event that recorded it, as
 * the store's CHECK constraint holds them. A strict reader refuses a `point` it does not
 * list, so the list grows with the store's in the same release.
 */
export const DECISION_POINTS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'decision',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
  'assignment',
] as const
