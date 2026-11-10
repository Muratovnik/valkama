/**
 * A state's name has the room it needs wherever it is printed, at a desktop's width and a
 * phone's, in both languages: with the standard names, longer in Russian than the workflow's
 * «Dev», and with a state renamed to thirty letters. The name stands clear of everything beside
 * it, a name cut short ends in an ellipsis and says itself whole in a `clipped` hint, and the
 * signs beside it keep their size.
 *
 * One representative of each way a name is laid out: a column's head, a lane's heading, a list
 * row, the card's state, a relation's row, a chain's member, a graph card and a frame's
 * header, a row of the task finder, and a row of the side panel's work.
 *
 * The space renames its «Dev» by the read itself: every answer the app reads names the state
 * as the renamed workflow would, so each surface is served the fixture it is usually served.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { liveFrame, liveRow, liveSpace } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { boardRoute, openBoard, serve } from './boardPage.ts'
import { graphRoute, serve as serveChain, smallChain } from './chainFixtures.ts'
import { settled } from './documentBeside.ts'
import { serveWide } from './laneWideFixture.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { projectId, projectScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** The state the space renamed its «Dev» to. */
const LONG = 'Ожидает внешнего подтверждения'

/** The standard names each language prints, the longest of them among them. */
const STANDARD: Record<string, string[]> = {
  'en-US': ['In progress', 'Queued', 'Backlog', 'Review', 'Done', 'Blocked'],
  'ru-RU': ['В работе', 'К работе', 'Бэклог', 'Проверка', 'Выполнено', 'Заблокировано'],
}

type Naming = 'standard' | 'long'

/**
 * Every answer of the API names «Dev» as the renamed workflow would. The app reads its answers
 * through `fetch`, so the rename is made there, before the page's own scripts run.
 */
async function renameDev(page: Page) {
  await page.addInitScript((long) => {
    const original = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await original(...args)
      const url = String(args[0] instanceof Request ? args[0].url : args[0])
      if (!url.includes('/api/') || !response.headers.get('content-type')?.includes('json'))
        return response
      const body = await response.text()
      const text = body.replaceAll(
        /"(name|state_name)":"Dev"/gu,
        (_, field: string) => `"${field}":"${long}"`,
      )
      return new Response(text, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      })
    }
  }, LONG)
}

/** Marks each element under `root` that prints one of `names`, and says how many. In the page. */
const markNames = (root: Element, names: string[]) => {
  const prints = (node: ChildNode) =>
    node.nodeType === Node.TEXT_NODE &&
    names.some((name) =>
      name.length > 20 ? node.textContent?.includes(name) : node.textContent?.trim() === name,
    )
  const owners = [...root.querySelectorAll('*')].filter(
    (element) =>
      element.getBoundingClientRect().width > 1 &&
      !element.closest('.visually-hidden') &&
      getComputedStyle(element).visibility !== 'hidden' &&
      [...element.childNodes].some((node) => prints(node)),
  )
  for (const [at, owner] of owners.entries()) (owner as HTMLElement).dataset.nameProbe = String(at)
  return owners.length
}

/**
 * Whether the reader sees the name's row whole, once `scroll` brings it into view as a reader
 * scrolls to it. A row the graph's camera leaves out is not one a reader sees; the camera is
 * not scrolled. In the page.
 */
const shown = (owner: Element, [rows, scroll]: [string, boolean]) => {
  const row = owner.closest(rows) ?? owner
  if (scroll && !row.closest('.vue-flow'))
    row.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
  const box = row.getBoundingClientRect()
  for (let up = row.parentElement; up; up = up.parentElement) {
    const scrolls =
      ['auto', 'scroll'].includes(getComputedStyle(up).overflowX) || up.matches('.vue-flow')
    if (!scrolls) continue
    const edge = up.getBoundingClientRect()
    if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5) return false
  }
  return box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5
}

/** What a printed name sits in: the row the surface lays it on. */
const ROWS = [
  '.column-head',
  '.lane-head',
  '[role="row"]',
  '.card-row',
  '.relations li',
  '.chain-row',
  '.flow-node',
  '.graph-frame-line',
  '[role="option"]',
  '.nav-row',
].join(', ')

/**
 * A name cut short: whether it ends in an ellipsis, and whether a hint says it whole. Its text
 * reaching past its own box, or past a box that cuts it, is cut too. In the page.
 */
const cutFaults = (owner: Element) => {
  const range = document.createRange()
  range.selectNodeContents(owner)
  const text = range.getBoundingClientRect()
  let right = owner.getBoundingClientRect().right
  let by = ''
  for (let up = owner.parentElement; up; up = up.parentElement) {
    if (getComputedStyle(up).overflowX === 'visible') continue
    const edge = up.getBoundingClientRect().right
    if (edge < right) [right, by] = [edge, String(up.className)]
  }
  const cut = owner.scrollWidth > owner.clientWidth + 0.5
  if (!cut && text.right <= right + 0.5) return []
  const whole = owner.textContent?.trim() ?? ''
  const hint = owner.closest<HTMLElement>('[data-tooltip]')
  // A phone shows no hints: a side panel's row there says its words whole as its name.
  const named = owner.closest('.nav-row-touch')?.querySelector('[aria-label]')
  const said = [hint?.dataset.tooltip, named?.getAttribute('aria-label')]
  return [
    ...(cut && getComputedStyle(owner).textOverflow === 'ellipsis'
      ? []
      : [['is cut without an ellipsis', by].filter(Boolean).join(' by ')]),
    ...(said.some((words) => words?.includes(whole)) ? [] : ['is cut and no hint says it whole']),
  ]
}

/**
 * What the name's drawn letters run into on its row: other words, glyphs or dots. A word's
 * letters are what its box shows of them, so a title cut short is read where it is drawn. In
 * the page.
 */
const meetFaults = (owner: Element, rows: string) => {
  const row = owner.closest(rows) ?? owner.parentElement?.parentElement ?? owner
  const range = document.createRange()
  const drawn = (element: Element, rects: Iterable<DOMRect>) => {
    const clips = getComputedStyle(element).overflowX !== 'visible'
    const box = element.getBoundingClientRect()
    return [...rects].map((rect) =>
      clips
        ? new DOMRect(
            Math.max(rect.left, box.left),
            rect.top,
            Math.min(rect.right, box.right) - Math.max(rect.left, box.left),
            rect.height,
          )
        : rect,
    )
  }
  // The words drawn under an element: words only a screen reader hears stand nowhere on the row.
  const words = (element: Element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Node[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
    return nodes.filter(
      (node) => node.textContent?.trim() && !node.parentElement?.closest('.visually-hidden'),
    )
  }
  const own = words(owner).flatMap((node) => {
    range.selectNodeContents(node)
    return drawn(owner, range.getClientRects())
  })
  const found: string[] = []
  // Lines stacked one under another may share the edges of their letters' boxes, which a
  // line's height lets overlap; what meets a name stands on its line, across half its height.
  const meets = (box: DOMRect, other: Element) => {
    for (const mine of own) {
      const across = Math.min(mine.right, box.right) - Math.max(mine.left, box.left)
      const down = Math.min(mine.bottom, box.bottom) - Math.max(mine.top, box.top)
      if (across > 0.5 && down > Math.min(mine.height, box.height) / 2)
        found.push(`meets ${other.getAttribute('class') ?? other.tagName}`)
    }
  }
  for (const node of words(row)) {
    const other = node.parentElement
    if (!other || other === owner || owner.contains(other) || other.contains(owner)) continue
    if (Number(getComputedStyle(other).opacity) === 0) continue
    range.selectNodeContents(node)
    for (const box of drawn(other, range.getClientRects())) meets(box, other)
  }
  for (const glyph of row.querySelectorAll('svg, .state-dot, .work-dots'))
    if (
      !glyph.contains(owner) &&
      !owner.contains(glyph) &&
      getComputedStyle(glyph).visibility !== 'hidden'
    )
      meets(glyph.getBoundingClientRect(), glyph)
  return found
}

/** The state's dot and the glyphs on the name's row, against the size each is drawn at. In the page. */
const signFaults = (owner: Element, rows: string) => {
  const row = (owner.closest(rows) ?? owner.parentElement ?? owner) as HTMLElement
  // The graph's camera scales what it draws; nothing else here is scaled.
  const pane = row.closest('.vue-flow__transformationpane')
  const scale = pane ? new DOMMatrix(getComputedStyle(pane).transform).a : 1
  const found: string[] = []
  const dot = owner.closest('.semantic-state')?.querySelector('.state-dot')
  const drawn = dot?.getBoundingClientRect()
  if (
    drawn &&
    drawn.width > 0 &&
    Math.abs(drawn.width - 7 * scale) + Math.abs(drawn.height - 7 * scale) > 1
  )
    found.push(`its dot is ${drawn.width.toFixed(1)}×${drawn.height.toFixed(1)}`)
  for (const glyph of row.querySelectorAll('svg[width]')) {
    const size = Number(glyph.getAttribute('width'))
    const { width } = glyph.getBoundingClientRect()
    if (width > 0 && Math.abs(width - size * scale) > 0.5)
      found.push(`a glyph of ${size}px is drawn ${width.toFixed(1)}px`)
  }
  return found
}

/** Each fault of the name `owner` prints, said with where it stands. */
async function faultsOf(owner: Locator, where: string) {
  const words = await owner.textContent()
  const said = `${where} «${words?.trim()}»`
  const faults = [
    ...(await owner.evaluate(cutFaults)),
    ...(await owner.evaluate(meetFaults, ROWS)),
    ...(await owner.evaluate(signFaults, ROWS)),
  ]
  return faults.map((one) => `${said} ${one}`)
}

/**
 * What is wrong with each state name `root` prints: one that runs into what stands beside it, one
 * cut short without an ellipsis or a hint saying it whole, and a dot or a glyph beside it drawn at
 * another size than its own.
 */
async function check(root: Locator, naming: Naming, locale: string, where: string) {
  await expect(root.first()).toBeVisible()
  await root.first().evaluate(async () => document.fonts.ready)
  const names = naming === 'long' ? [LONG] : (STANDARD[locale] ?? [])
  const printed = await root.first().evaluate(markNames, names)
  const found: string[] = []
  const seen = new Set<number>()
  // The names in view first, then each of the rest scrolled to: a scroll may redraw what
  // depends on it, such as a lane's word for the states past the edge, and a name it took away
  // is not judged.
  for (const scroll of [false, true])
    for (let at = 0; at < printed; at += 1) {
      const owner = root.first().locator(`[data-name-probe="${at}"]`)
      if (seen.has(at) || (await owner.count()) === 0) continue
      if (!(await owner.evaluate(shown, [ROWS, scroll] as [string, boolean]))) continue
      seen.add(at)
      found.push(...(await faultsOf(owner, where)))
    }
  return { found: [...new Set(found)], printed: seen.size }
}

const SURFACES = ['column', 'lane', 'list', 'card', 'chain', 'graph', 'finder', 'rail'] as const
type Surface = (typeof SURFACES)[number]

/** The finder's answer: the card's item, in Dev. */
function finderAnswer() {
  return {
    interface_version: 'valkama-planning-search',
    query: 'Work',
    limit: 50,
    has_more: false,
    items: [
      {
        target: {
          project_id: projectId,
          space_ref: spaceRef,
          reference: 'MAIN-264',
          writable: true,
        },
        item: {
          work_item_id: workItem.work_item_id,
          planning_space_id: workItem.planning_space_id,
          reference: 'MAIN-264',
          title: 'Work that waits on someone outside the team before it can go on',
          kind: 'task',
          priority: 'medium',
          state: { name: 'Dev', category: 'active', is_terminal: false },
          claim_ref: '',
        },
      },
    ],
    coverage: [{ project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null }],
  }
}

/** Opens `surface` and reads its printed state names. */
async function readSurface(page: Page, surface: Surface, naming: Naming, locale: string) {
  const where = surface
  if (surface === 'column') {
    await installBackend(page)
    await serve(page)
    await page.goto(boardRoute())
    return check(page.locator('.work-item-board'), naming, locale, where)
  }
  if (surface === 'lane') {
    await installBackend(page)
    await serve(page)
    await serveWide(page)
    await openBoard(page)
    return check(page.locator('.work-item-lanes'), naming, locale, where)
  }
  if (surface === 'list') {
    await installBackend(page)
    await serve(page)
    await page.goto(boardRoute({ view: 'list' }))
    await expect(page.getByRole('row').nth(1)).toBeVisible()
    return check(page.locator('.work-item-list, table').first(), naming, locale, where)
  }
  if (surface === 'card') {
    await installBackend(page, {
      card: (card) => ({
        ...card,
        links: [
          ...((card.links as unknown[]) ?? []),
          {
            kind: 'discovered-from',
            direction: 'outgoing',
            work_item_id: '00000000-0000-4000-8000-000000000777',
            reference: 'MAIN-777',
            title: 'Ask the vendor',
            state_name: 'Dev',
            state_category: 'active',
            is_terminal: false,
            state_unavailable: null,
          },
        ],
      }),
    })
    await page.goto(cardRoute())
    const drawer = page.locator('.drawer')
    const facts = await check(drawer.locator('.card-facts'), naming, locale, 'card')
    await showRelations(page, locale)
    const links = await check(drawer.locator('.relations'), naming, locale, 'relations')
    return { found: [...facts.found, ...links.found], printed: facts.printed + links.printed }
  }
  if (surface === 'chain') {
    await installBackend(page)
    const { chain, edges, items } = smallChain()
    await serveChain(page, chain, items, edges)
    await page.goto(cardRoute())
    await showRelations(page, locale)
    await expect(page.locator('.drawer section.chain')).toBeVisible()
    return check(page.locator('.drawer section.chain'), naming, locale, where)
  }
  if (surface === 'graph') {
    await installBackend(page)
    const { chain, edges, items } = smallChain()
    await serveChain(page, chain, items, edges)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    return check(page.locator('.graph-canvas'), naming, locale, where)
  }
  if (surface === 'finder') {
    await installBackend(page)
    await page.route('**/api/modules/planning/search?*', (route) =>
      route.fulfill({ json: finderAnswer() }),
    )
    await page.goto(boardRoute())
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').fill('Work')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    return check(dialog, naming, locale, where)
  }
  // The side panel's work: a closed pinned row says its state as its word.
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(boardRoute())
  await expect.poll(() => streams.open()).toHaveLength(1)
  const name = naming === 'long' ? LONG : 'Dev'
  await streams.live(
    liveFrame([
      liveSpace('MAIN', [
        liveRow('MAIN-30', { pinned: true, state_name: name, title: 'Pinned and idle' }),
        liveRow('MAIN-31', {
          pinned: true,
          state_name: 'Done',
          is_terminal: true,
          title: 'Closed',
        }),
        liveRow('MAIN-32', {
          pinned: true,
          state_name: name,
          is_terminal: true,
          title: 'Closed in the renamed state',
        }),
      ]),
    ]),
  )
  return check(await railRows(page), naming, locale, where)
}

/**
 * The rows of the side panel's work: beside the page on a desktop, and on a phone in the panel
 * its rail opens over the page, as a person opens it.
 */
async function railRows(page: Page) {
  const beside = page.locator('.nav-work-list')
  if (await beside.isVisible()) return beside
  await page.locator('.nav-work-rail').click()
  const panel = page.locator('.side-panel-body')
  await expect(panel.locator('.nav-row').first()).toBeVisible()
  await settled(panel)
  await expect
    .poll(() => panel.evaluate((body) => body.getBoundingClientRect().left))
    .toBeGreaterThanOrEqual(0)
  return panel
}

const cardRoute = () =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity(workItemRef),
  })

/** Opens the card's Relations, where its links and its chain stand. */
async function showRelations(page: Page, locale: string) {
  const tab = locale === 'ru-RU' ? 'Связи' : 'Relations'
  await page.locator('.drawer').getByRole('tab', { name: tab, exact: true }).click()
  await expect(page.locator('.drawer .relations')).toBeVisible()
}

/** How each naming reaches the page: the standard names as served, or «Dev» renamed long. */
const RENAME: Record<Naming, (page: Page) => Promise<void>> = {
  long: renameDev,
  standard: async () => {},
}

for (const locale of ['ru-RU', 'en-US'])
  for (const naming of ['standard', 'long'] as const)
    test.describe(`${locale}, ${naming === 'long' ? 'a state renamed long' : 'the standard names'}`, () => {
      test.use({ locale })
      for (const width of [1280, 390])
        for (const surface of SURFACES)
          test(`${surface} at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            await RENAME[naming](page)
            const { found, printed } = await readSurface(page, surface, naming, locale)
            expect(printed, 'state names printed').toBeGreaterThan(0)
            expect(found).toEqual([])
          })
    })
