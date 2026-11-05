/**
 * The points of an entry's lists, as the form offers them for steps.
 *
 * The oracle is the plan for the action: every point of every list in the order it is drawn,
 * a nested one a point of its own; the step says the point's own Markdown; a point is the
 * same step as another when its words and their case match whatever the spaces; and the
 * server holds a checklist to 100 steps of at most 1000 characters each.
 */
import { describe, expect, it } from 'vitest'

import {
  checklistWith,
  listPoints,
  MAX_STEP_TEXT,
  standings,
} from '@/features/discussion-thread/utils/stepPoints.ts'

import { parseRichText } from '@/shared/lib/richText.ts'

const LIST = [
  'What is left:',
  '1. Check the **skill** against `docs/contract.md`',
  '2. Write the rule',
  '   - [ ] with a nested task',
  '   - and its sibling',
  '3. Two lines',
  '   of one point',
  '',
  '> - a quoted point',
].join('\n')

describe('the source of a list item', () => {
  it('is the Markdown after its marker and task box, without the lists nested in it', () => {
    const [, list] = parseRichText(LIST)
    if (list?.kind !== 'list') throw new Error('Expected the list')
    expect(list.items.map((item) => item.source)).toEqual([
      'Check the **skill** against `docs/contract.md`',
      'Write the rule',
      'Two lines\nof one point',
    ])
    const nested = list.items[1]?.children.find((block) => block.kind === 'list')
    if (nested?.kind !== 'list') throw new Error('Expected the nested list')
    expect(nested.items.map((item) => item.source)).toEqual([
      'with a nested task',
      'and its sibling',
    ])
  })
})

describe('the points of a text', () => {
  it('are every point of every list in drawn order, nested ones a level deeper', () => {
    expect(listPoints([LIST]).map(({ depth, source }) => [depth, source])).toEqual([
      [0, 'Check the **skill** against `docs/contract.md`'],
      [0, 'Write the rule'],
      [1, 'with a nested task'],
      [1, 'and its sibling'],
      [0, 'Two lines\nof one point'],
      [0, 'a quoted point'],
    ])
  })

  it('read as their words, without the markup the step keeps', () => {
    expect(listPoints([LIST])[0]?.words).toBe('Check the skill against docs/contract.md')
  })

  it('are none in a text without a list, and an empty item is no point', () => {
    expect(listPoints(['Just a paragraph, with 1. a number in it'])).toEqual([])
    expect(listPoints(['-\n- real'])).toMatchObject([{ source: 'real' }])
  })

  it('come from each text in turn, as a report says what was done and then what is next', () => {
    expect(listPoints(['- shipped', 'Next:\n- review']).map((point) => point.source)).toEqual([
      'shipped',
      'review',
    ])
  })
})

const points = (...sources: string[]) => listPoints([sources.map((s) => `- ${s}`).join('\n')])
/** Why each point cannot be a step, or null, against an item with these steps. */
const bars = (sources: string[], steps: string[] = []) =>
  standings(
    points(...sources),
    steps.map((text) => ({ text })),
  ).map((row) => row.bar)

describe('what a point can be', () => {
  it('is already a step when a step says it, whatever the spaces, and only with the same case', () => {
    expect(bars(['Write  the   rule', 'write the rule', 'New one'], ['Write the rule '])).toEqual([
      'exists',
      null,
      null,
    ])
  })

  it('repeats a point above it, and the first of them stays free', () => {
    expect(bars(['Same', 'Other', 'Same'])).toEqual([null, null, 'repeat'])
  })

  it('may be 1000 characters, counted as characters, and not one more', () => {
    const at = 'a'.repeat(MAX_STEP_TEXT)
    // Two UTF-16 units each, one character each, as the server counts them.
    const wide = '😀'.repeat(MAX_STEP_TEXT)
    expect(bars([at, `${at}b`, wide])).toEqual([null, 'long', null])
  })
})

describe('the checklist sent', () => {
  it('is every step the item has, by its id, and the chosen points after them', () => {
    const steps = [
      { id: 'a', text: 'One', done: true, claimed_by: '', done_by: 'kolo' },
      { id: 'b', text: 'Two', done: false, claimed_by: 'kolo', done_by: '' },
    ]
    expect(checklistWith(steps, ['Three'])).toEqual([
      { id: 'a', text: 'One' },
      { id: 'b', text: 'Two' },
      'Three',
    ])
  })
})
