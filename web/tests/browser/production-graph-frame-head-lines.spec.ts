/**
 * An epic's header as tall as its title: one to three lines of it, the counts right under
 * the last, and no band of empty header between them. Everything in a header starts at one
 * left edge, the one its frame's cards start at. Zoomed out, the band's grown words stay
 * inside the header they were given.
 *
 * Served a small space made for it, with titles of one, two and three lines at a header's
 * width, so each case is on the field by its own numbers.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

const { model } = broadSpace()
const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function stateOf(key: string): WorkItemBrief['state'] {
  const found = model.work_items.find((entry) => entry.state.key === key)
  if (!found) throw new Error(`the broad space has no item in ${key}`)
  return found.state
}

function item(n: number, key: string, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    ...model.work_items[0],
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title: `Item ${n}`,
    kind: 'task',
    container: false,
    parent_id: null,
    state: stateOf(key),
    claim_ref: '',
    claim_state: null,
    ...overrides,
  }
}

const epic = (n: number, title: string) => item(n, 'dev', { kind: 'epic', container: true, title })
const under = (parent: number, from: number, keys: readonly string[]) =>
  keys.map((key, index) => item(from + index, key, { parent_id: identity(parent) }))

/** Open epics whose titles take one, two and three lines, each over the same two tasks. */
const TITLED = { 1: 1, 10: 2, 20: 3 } as const
const SPACE: WorkItemBrief[] = [
  epic(1, 'Connect the release'),
  ...under(1, 2, ['todo', 'done']),
  epic(10, 'Reconcile the release notes with the installer'),
  ...under(10, 11, ['todo', 'done']),
  epic(20, 'Reconcile the release notes with what the installer actually ships to the desktop'),
  ...under(20, 21, ['todo', 'done']),
  // Folded, with every group in its counts and what the fold hides under its edge.
  epic(40, 'Crowded'),
  ...under(40, 100, [
    ...Array.from({ length: 30 }, () => 'done'),
    ...Array.from({ length: 25 }, () => 'review'),
    'blocked',
    'dev',
  ]),
  // An epic nothing was filed under, and the work under none.
  item(60, 'review', { kind: 'epic', title: 'Plan the next release' }),
  ...Array.from({ length: 3 }, (_, index) => item(400 + index, 'todo')),
]

async function openField(page: Page, width: number, items = SPACE) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = items
      body.links = []
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

/** Each frame's header read in the field's own units, the camera's scale taken out. */
function readHeaders(page: Page) {
  return page.locator('.graph-frame').evaluateAll((frames) =>
    frames.map((frame) => {
      const box = frame.getBoundingClientRect()
      const scale = box.width / (frame as HTMLElement).offsetWidth
      const head = frame.querySelector('.graph-frame-head') as HTMLElement
      const at = (element: Element | null | undefined) => {
        if (!element) return null
        const part = element.getBoundingClientRect()
        return {
          left: (part.left - box.left) / scale,
          top: (part.top - box.top) / scale,
          bottom: (part.bottom - box.top) / scale,
        }
      }
      // The epic's title under the reference line; the work under no epic names itself on it.
      const title = [...frame.querySelectorAll<HTMLElement>('.graph-frame-title')].find(
        (element) => !element.closest('.graph-frame-line'),
      )
      const line = frame.querySelector('.graph-frame-line')
      // What the reference line starts with: the chevron, or the first thing drawn on it.
      const lead = frame.querySelector('.graph-frame-fold') ?? line?.firstElementChild
      return {
        id: (frame as HTMLElement).dataset.frame ?? '',
        head: head.getBoundingClientRect().height / scale,
        line: at(line),
        lead: at(lead),
        title: at(title),
        titleLines: title
          ? Math.round(title.offsetHeight / Number.parseFloat(getComputedStyle(title).lineHeight))
          : 0,
        titleWhole: !title || title.scrollHeight <= title.clientHeight,
        counts: [...frame.querySelectorAll('.graph-frame-count')].map((count) => at(count)),
        inside: at(frame.querySelector('.graph-frame-inside')),
        edge: at(frame.querySelector('.frame-progress')),
        headBottom: at(head)?.bottom ?? 0,
      }
    }),
  )
}

type Header = Awaited<ReturnType<typeof readHeaders>>[number]

/** `value`, which the case needs drawn. */
function drawn<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is not drawn`)
  return value
}
const headerOf = (headers: Header[], n: number) => {
  const found = headers.find((header) => header.id === identity(n))
  if (!found) throw new Error(`MAIN-${n} has no frame`)
  return found
}

for (const width of [1280, 390]) {
  test(`a header is as tall as its title, the counts right under it, at ${width}px`, async ({
    page,
  }) => {
    await openField(page, width)
    await expect(page.locator('.graph-frame')).toHaveCount(6)
    const headers = await readHeaders(page)
    for (const [n, lines] of Object.entries(TITLED))
      expect(headerOf(headers, Number(n)).titleLines, `MAIN-${n}'s title`).toBe(lines)

    for (const header of headers) {
      const where = header.id
      expect(header.titleWhole, `${where}: the title is cut`).toBe(true)
      const firstCount = drawn(header.counts[0], `${where}'s counts`)
      const line = drawn(header.line, `${where}'s reference line`)
      // The air between two of the header's lines, read off the first two of them.
      const above = header.title ?? line
      const lineGap = (header.title?.top ?? firstCount.top) - line.bottom
      expect(
        firstCount.top - above.bottom,
        `${where}: the band under the title`,
      ).toBeLessThanOrEqual(lineGap + 0.5)
      // Whatever stands lowest stays inside the header the layout made room for.
      const lowest = Math.max(
        ...[header.edge, header.inside, ...header.counts].map((part) => part?.bottom ?? 0),
      )
      expect(lowest, `${where}: its foot`).toBeLessThanOrEqual(header.headBottom + 0.5)
    }

    // One title line more is one line's height more, and nothing else.
    const [one, two, three] = [1, 10, 20].map((n) => headerOf(headers, n))
    const titleLine =
      (two.title?.bottom ?? 0) -
      (two.title?.top ?? 0) -
      (one.title?.bottom ?? 0) +
      (one.title?.top ?? 0)
    expect(titleLine).toBeGreaterThan(10)
    expect(two.head - one.head).toBeCloseTo(titleLine, 0)
    expect(three.head - two.head).toBeCloseTo(titleLine, 0)
  })

  test(`everything in a header starts at one left edge, its cards' own, at ${width}px`, async ({
    page,
  }) => {
    await openField(page, width)
    await expect(page.locator('.graph-frame')).toHaveCount(6)
    const headers = await readHeaders(page)
    for (const header of headers) {
      const edges = [
        header.lead,
        header.title,
        ...header.counts.slice(0, 1),
        header.inside,
        header.edge,
      ]
        .filter((part) => part !== null)
        .map((part) => part.left)
      expect(edges.length, header.id).toBeGreaterThanOrEqual(3)
      expect(
        Math.max(...edges) - Math.min(...edges),
        `${header.id}: its left edges`,
      ).toBeLessThanOrEqual(0.5)
    }
    // The cards in an open frame start where its header's words do.
    const frame = page.locator(`.graph-frame[data-frame="${identity(1)}"]`)
    const card = page.locator(`.flow-node-card[data-walk-target="${identity(2)}"]`)
    const boxes = await Promise.all([frame.boundingBox(), card.boundingBox()])
    const [frameBox, cardBox] = boxes.map((box) => drawn(box, 'MAIN-1 and its card'))
    const scale = await frame.evaluate(
      (element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth,
    )
    expect((cardBox.x - frameBox.x) / scale).toBeCloseTo(headerOf(headers, 1).title?.left ?? 0, 0)
  })
}

/** The same space among enough other epics that its whole field is zoomed out. */
const AMONG_MANY: WorkItemBrief[] = [
  ...SPACE,
  ...Array.from({ length: 90 }, (_, index) => item(1000 + index, 'review', { kind: 'epic' })),
]

/**
 * Where the grown rows of a band end, and where its edge starts: read in the layout's own
 * units, from the frame's top left, which the rows' transform leaves as they were laid out.
 */
function bandFoot(frame: Locator) {
  return frame.evaluate((element) => {
    const offset = (part: HTMLElement, side: 'offsetLeft' | 'offsetTop') => {
      let at = 0
      for (
        let step: Element | null = part;
        step && step !== element;
        step = (step as HTMLElement).offsetParent
      )
        at += (step as HTMLElement)[side]
      return at
    }
    const top = (part: HTMLElement) => offset(part, 'offsetTop')
    const head = element.querySelector('.graph-frame-head') as HTMLElement
    const rows = [...head.querySelectorAll<HTMLElement>('.graph-frame-line, .graph-frame-inside')]
    const foot = Math.max(...rows.map((row) => top(row) + row.offsetHeight))
    const edge = head.querySelector<HTMLElement>('.frame-progress')
    const end = edge ? top(edge) : top(head) + head.offsetHeight
    const band = head.querySelector('.graph-frame-open') as HTMLElement
    // The edge runs under the band from the left its words start at, as wide as they are.
    const across = edge && {
      left: offset(edge, 'offsetLeft') - offset(band, 'offsetLeft'),
      width: edge.offsetWidth - band.offsetWidth,
    }
    return { across, foot, end }
  })
}

for (const width of [1280, 390]) {
  test(`zoomed out, a band's grown words stay inside its header at ${width}px`, async ({
    page,
  }) => {
    await openField(page, width, AMONG_MANY)
    await page.getByRole('button', { name: 'Весь граф', exact: true }).click()
    await expect(page.locator('.graph-frame.overview').first()).toBeVisible()
    for (const n of [1, 10, 20, 40, 60]) {
      const { across, foot, end } = await bandFoot(
        page.locator(`.graph-frame[data-frame="${identity(n)}"]`),
      )
      expect(foot, `MAIN-${n}`).toBeLessThanOrEqual(end + 0.5)
      // MAIN-60 has nothing filed under it, so no edge; every other band has one.
      expect(across, `MAIN-${n}'s edge`).toEqual(n === 60 ? null : { left: 0, width: 0 })
    }
  })
}
