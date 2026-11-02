/**
 * Where a question stands among the comments, and how much of a description its
 * option shows: the two rules the first screen of a discussion comes down to.
 */
import { describe, expect, it } from 'vitest'

import { threadRows } from '@/widgets/work-item-inspector/utils/threadRows.ts'

import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

import { requestEntry } from './support/inputRequests.ts'

const comment = (id: number, at: string | null): WorkItem['comments'][number] =>
  at === null
    ? { id, author: 'user', at, kind: 'report', report: { done: 'd', next: 'n' }, body: '' }
    : { id, author: 'user', at, kind: 'comment', report: null, body: `comment ${id}` }

function asked(id: string, createdAt: string, status: 'pending' | 'declined' = 'pending') {
  const entry = requestEntry()
  entry.request = { ...entry.request, request_id: id, created_at: createdAt, status }
  return entry
}

describe('threadRows', () => {
  it('stands what waits first however old, and the rest by time, newest first', () => {
    const rows = threadRows(
      [comment(1, '2026-01-01T00:00:00Z'), comment(2, '2026-03-01T00:00:00Z'), comment(3, null)],
      [
        asked('waiting-old', '2020-01-01T00:00:00Z'),
        asked('waiting-new', '2021-01-01T00:00:00Z'),
        asked('closed', '2026-02-01T00:00:00Z', 'declined'),
      ],
      new Set(),
    )
    expect(rows.map((row) => row.key)).toEqual([
      'question-waiting-new',
      'question-waiting-old',
      'comment-2',
      'question-closed',
      'comment-1',
      'comment-3',
    ])
  })

  it('keeps a question that waited while the card was open where it stood', () => {
    const closed = asked('was-waiting', '2020-01-01T00:00:00Z', 'declined')
    const comments = [comment(1, '2026-01-01T00:00:00Z')]
    const keys = (kept: Set<string>) => threadRows(comments, [closed], kept).map((row) => row.key)
    expect(keys(new Set())).toEqual(['comment-1', 'question-was-waiting'])
    expect(keys(new Set(['was-waiting']))).toEqual(['question-was-waiting', 'comment-1'])
  })

  it('orders comments of one moment by their ids, as the thread always did', () => {
    const at = '2026-01-01T00:00:00Z'
    const rows = threadRows([comment(1, at), comment(2, at)], [], new Set())
    expect(rows.map((row) => row.key)).toEqual(['comment-2', 'comment-1'])
  })
})

const described = (id: string, description?: string) => ({
  id,
  label: id,
  ...(description ? { description } : {}),
})

describe('descriptionViews', () => {
  it('stands a line whole, shows a text’s first words and leaves nothing for none', () => {
    const views = descriptionViews([
      described('line', 'It says this and no more.'),
      described('long', 'x'.repeat(121)),
      described('paragraphs', 'One.\n\nTwo.'),
      described('none'),
    ])
    expect([...views.values()]).toEqual(['line', 'excerpt', 'excerpt', 'none'])
  })

  it('folds every description once there are more than a screen holds beside the labels', () => {
    const options = Array.from({ length: 7 }, (_, index) => described(`o${index}`, 'A line.'))
    expect(new Set(descriptionViews(options).values())).toEqual(new Set(['folded']))
    expect(new Set(descriptionViews(options.slice(0, 6)).values())).toEqual(new Set(['line']))
  })

  it('counts only what has a description towards the crowd', () => {
    const options = [
      ...Array.from({ length: 12 }, (_, index) => described(`bare${index}`)),
      described('line', 'A line.'),
    ]
    expect(descriptionViews(options).get('line')).toBe('line')
  })
})
