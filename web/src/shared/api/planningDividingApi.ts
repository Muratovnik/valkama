/**
 * The writes that change what work is part of, from a card: split a part off a task with some of
 * its conditions, convert a task into a stage or a goal or a goal or stage with nothing under it
 * back into a task, and move work out of its goal with the reason it leaves.
 *
 * The card reads its item again after each, so none answers with more than a card needs to say
 * what it did. A refusal comes as the planning boundary throws it.
 */

import { write } from '@/shared/api/planningApi.ts'

/**
 * Split off a part of the task `from`: a new item beside it, under its parent and accepted as it
 * is, titled `title`, taking the conditions `steps` names by id with their ticks.
 */
export async function splitWorkItem(input: {
  from: string
  steps: readonly string[]
  title: string
}): Promise<void> {
  await write('/api/planning/work-items', {
    split_from: input.from,
    title: input.title,
    steps: [...input.steps],
  })
}

/**
 * Convert work in place: a task to `stage` under a parent or `goal` without one, the word its
 * place gives, or a goal or a stage with nothing under it to `task`.
 */
export async function convertWorkItem(input: {
  id: string
  to: 'goal' | 'stage' | 'task'
}): Promise<void> {
  await write('/api/planning/work-item/convert', { ...input })
}

/** Move work out of its goal or stage to the top level, with the reason the goal keeps. */
export async function moveWorkItemOut(input: { id: string; reason: string }): Promise<void> {
  await write('/api/planning/work-item/move-out', { ...input })
}
