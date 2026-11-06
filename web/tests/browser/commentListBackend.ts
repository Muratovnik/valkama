import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

import card from '../fixtures/server/card.json' with { type: 'json' }
import served from '../fixtures/server/requests.json' with { type: 'json' }
import { asRoot } from '../support/threads.ts'
import { doneState, workItem, workItemRef } from './planningFixtures.ts'
import { openQuestion, question } from './questionBackend.ts'

type Request = InputRequestEntry['request']

/**
 * The list as the server wrote it under its comment: `comment_work_item` with a `list`, in the
 * temporary store `tests/test_web_contract_fixtures.py` answers from. Its field, its id and the
 * comment it names are the server's own; the card the suite opens takes it over.
 */
const written = served.items.find((entry) => entry.request.comment_id !== null)?.request
const root = card.state.payload.work_item.comments.find(
  (comment) => comment.id === written?.comment_id,
)
if (!written || !root) throw new Error('The server fixtures hold no list under a comment')
const field = written.fields[0] as InputRequestField

/** Three more options of the same kind, one of them with a description that folds. */
const options: InputRequestField['options'] = [
  ...field.options,
  { id: 'c', label: 'Split the guard' },
  {
    id: 'd',
    label: 'Rewrite the reader',
    description: Array.from(
      { length: 6 },
      (_, index) => `Paragraph ${index + 1} of what this costs, long enough to fold away.`,
    ).join('\n\n'),
  },
  { id: 'e', label: 'Leave it for later' },
]
const LIST_ID = written.request_id
export const LIST_LABEL = field.label
export const OPTIONS = options.length

export function listEntry(change: Partial<Request> = {}): InputRequestEntry {
  return question({
    ...(written as Partial<Request>),
    fields: [{ ...field, options }],
    work_item_id: workItem.work_item_id,
    reference: workItemRef.reference,
    title: workItem.title,
    ...change,
  })
}

/** The card with the list's comment on it, open on the list. */
export async function openList(page: Page, entries = [listEntry()]) {
  const opened = await openQuestion(page, entries)
  opened.backend.item.comments.push({ ...asRoot, ...root } as WorkItem['comments'][number])
  await opened.stream.signal('agents')
  const article = opened.drawer.locator('article.thread-entry', { hasText: root?.body })
  await expect(article).toBeVisible()
  return { ...opened, article, list: article.locator('.comment-list') }
}

const DEV = { ...workItem.state }

/** The item closes or opens again elsewhere, and the list reads as the server would say it. */
export async function moveItem(
  opened: Awaited<ReturnType<typeof openList>>,
  closed: boolean,
  list: Partial<Request> = {},
) {
  opened.backend.item.state = closed ? { ...doneState } : DEV
  opened.backend.item.revision += 1
  opened.requests.settle(LIST_ID, list)
  await opened.stream.signal('agents')
}

export const boxes = (list: Locator) => list.locator('input[type="checkbox"]')

/**
 * Where everything in the list stands, read in one go off the comment's sheet: the comment
 * text's first line and the label's words through a Range, every box and every mark that stands
 * in a box's place, the comment glyph's strokes, the list's own box, and the buttons of its rows.
 */
export const measure = (article: Locator) =>
  article.evaluate((node) => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const drawnLeft = (element: Element | null) => {
      if (!element) return null
      const parts =
        element instanceof SVGElement
          ? [...element.querySelectorAll('path, polyline, line')].map((part) =>
              part.getBoundingClientRect(),
            )
          : (() => {
              const range = document.createRange()
              range.selectNodeContents(element)
              return [...range.getClientRects()].filter((rect) => rect.width > 0)
            })()
      return parts.length ? Math.min(...parts.map((rect) => rect.left)) : null
    }
    const list = node.querySelector('.comment-list')
    if (!list) throw new Error('No list in this comment')
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const shown = (element: Element) => element.getClientRects().length > 0
    const { left, right } = list.getBoundingClientRect()
    return {
      text: drawnLeft(node.querySelector('.thread-text p')) ?? Number.NaN,
      list: { left, right },
      label: drawnLeft(list.querySelector('.comment-list-label')),
      boxes: [...list.querySelectorAll('input[type="checkbox"]')].map(
        (box) => box.getBoundingClientRect().left,
      ),
      marks: [...list.querySelectorAll('.comment-list-mark svg')].map((mark) => drawnLeft(mark)),
      glyph: drawnLeft(list.querySelector('.request-note-glyph')),
      // The pair ends at its last button; the one before it stands to its left.
      ends: [
        ...[...list.querySelectorAll('.request-pair')].map(
          (pair) =>
            [...pair.querySelectorAll('button')].findLast((button) => shown(button)) ?? null,
        ),
        list.querySelector('.comment-list-change'),
      ]
        .filter((button) => button !== null && shown(button))
        .map((button) => button?.getBoundingClientRect().right ?? Number.NaN),
      pair: [...list.querySelectorAll('.request-pair button')]
        .filter((button) => shown(button))
        .map((button) => Math.round(button.getBoundingClientRect().top)),
    }
  })

/**
 * Whether a tap anywhere across a 44 px square centred on a control reaches it: the middle of
 * every side two pixels in, and the corners as far in as a control's rounded corner takes them.
 */
export const answersTap = (control: Locator) =>
  control.evaluate((node) => {
    // A point off the screen hits nothing, whatever stands there.
    node.scrollIntoView({ block: 'center' })
    const { left, top, width, height } = node.getBoundingClientRect()
    const [x, y] = [left + width / 2, top + height / 2]
    const [side, corner] = [21, 18]
    const points = [
      [-side, 0],
      [side, 0],
      [0, -side],
      [0, side],
      ...[-corner, corner].flatMap((dx) => [-corner, corner].map((dy) => [dx, dy])),
    ]
    return points.every(([dx = 0, dy = 0]) => {
      const hit = document.elementFromPoint(x + dx, y + dy)
      return hit !== null && (hit === node || node.contains(hit))
    })
  })
