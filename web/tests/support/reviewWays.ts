/**
 * A review of twelve points in four groups, each point with a way of three options under
 * `accept`, one of them recommended except on the last point, and descriptions long enough to
 * fold: the shape of a review whose every accepted point used to unfold its way at once. The
 * wording is neutral.
 */
import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

const GROUPS = ['Card', 'Board', 'Navigation', 'Editor'] as const

const description = (index: number) =>
  `Fact ${index}. The control stands in the row of facts, between the copy of the link and the ` +
  'date, and reads as one more fact rather than as something to press; two people missed it.'

const why = (index: number) =>
  `Point ${index} acts on the task, and an action stands with the other actions.`

/** The last point recommends no way, so accepting it leaves its way to be chosen. */
const LAST = 21

const options = (index: number) => [
  {
    id: 'head',
    label: `In the head's actions, on the right`,
    description:
      'With the copy of the link, in the right group of the head, beside closing; the row of ' +
      'facts stays facts, and the press moves with the link wherever the head goes.',
    ...(index % 4 === 1 || index === LAST ? {} : { recommended: true }),
  },
  {
    id: 'menu',
    label: 'In the menu of the head',
    description: 'Fewer icons, one press further.',
    ...(index % 4 === 1 && index !== LAST ? { recommended: true } : {}),
  },
  { id: 'keep', label: 'Keep it, add a caption', description: 'Where it was.' },
]

export const WAYS_PROMPT = 'Decisions on the second part of the review: facts and options for each.'

export const wayReviewFields: InputRequestField[] = Array.from({ length: 12 }, (_, at) => {
  const index = at + 10
  const point: InputRequestField = {
    id: `p${index}`,
    label: `P${index} The control in the row of facts (MAIN-${index + 10})`,
    type: 'verdict',
    required: false,
    options: [],
    group: GROUPS[Math.floor(at / 3)],
    recommended: 'accept',
    description: description(index),
    ...(at % 2 ? {} : { why: why(index) }),
  }
  const way: InputRequestField = {
    id: `p${index}-way`,
    label: 'Where',
    type: 'choice',
    required: true,
    options: options(index),
    under: { field: point.id, option: 'accept' },
  }
  return [point, way]
}).flat()
