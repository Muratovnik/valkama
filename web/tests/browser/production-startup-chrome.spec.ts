/**
 * The shell's chrome on its first frames, while the module list, the projects and the list of
 * work going on now are still on their way: every value it shows is the final one, or its
 * place stands empty, and nothing on the rail moves when the rows come.
 *
 * At launch the context bar said the module's id, `planning`, until the module list had been
 * read, and «Global» over a project's address until the projects had; the rail drew
 * «Analytics» under «Work» and dropped it by the height of the list when the first frame came.
 * Each read here is held for longer than a real one takes, and the page is sampled on every
 * frame and every mutation from its first script, so a value that stood for one frame is seen.
 *
 * The list's first frame came on the space's stream, which opens after the space's read: on a
 * large space «Analytics» stood hidden for two seconds. The shell now opens a stream of its own
 * as it starts, and the last two scenarios hold the space's read that long.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** What the chrome showed at one moment; a place that paints nothing reads as ''. */
interface Sample {
  /** The context bar is on the page. */
  bar: boolean
  /** The space's board is drawn. */
  board: boolean
  /** Each entry of the rail that is drawn, by its kind and words, at its top-left corner. */
  rail: Record<string, [number, number]>
  scope: string
  t: number
  title: string
}

/** Runs in the page from its first script: note the chrome whenever it changes. */
function sampleChrome() {
  const start = performance.now()
  const samples: Sample[] = []
  let last = ''
  // This runs in the page, where nothing from the module's scope is defined.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const drawn = (node: Element) =>
    node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const words = (node: Element | null) =>
    node !== null && drawn(node) ? (node.textContent ?? '').replaceAll(/\s+/gu, ' ').trim() : ''
  const sample = () => {
    const rail: Record<string, [number, number]> = {}
    for (const node of document.querySelectorAll(
      '.app-nav-frame :is(.work-action, .nav-item, .nav-group-heading)',
    )) {
      if (!drawn(node)) continue
      const box = node.getBoundingClientRect()
      rail[`${node.className.split(' ')[0]}:${words(node)}`] = [box.left, box.top]
    }
    const next = {
      bar: document.querySelector('.context-bar') !== null,
      board: document.querySelector('.work-item-board') !== null,
      rail,
      scope: words(document.querySelector('.operating-scope [role="combobox"]')),
      title: words(document.querySelector('.context-bar .module-title')),
    }
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    samples.push({ t: Math.round(performance.now() - start), ...next })
  }
  Object.defineProperty(window, '__chromeSamples', { value: samples })
  new MutationObserver(sample).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  })
  const frame = () => {
    sample()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Each read held this long: well past a frame, so the chrome stands without it for a while. */
interface Holds {
  context: number
  /** After the stream opens, before its first frame. */
  frame: number
  modules: number
  /** The space's own read, which the space's stream waits for. */
  board?: number
}

/** The space's read, which a large space takes seconds over. */
async function holdSpaceRead(page: Page, ms: number) {
  await page.route(
    (url) => url.pathname === '/api/planning',
    async (route) => {
      await pause(ms)
      await route.fallback()
    },
  )
}

const samplesOf = (page: Page) =>
  page.evaluate(() =>
    structuredClone((window as unknown as { __chromeSamples: Sample[] }).__chromeSamples),
  )

async function launch(page: Page, address: string, holds: Holds): Promise<Sample[]> {
  await page.setViewportSize({ width: 1500, height: 950 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.route('**/api/modules', async (route) => {
    await pause(holds.modules)
    await route.fallback()
  })
  await page.route('**/api/platform/context?*', async (route) => {
    await pause(holds.context)
    await route.fallback()
  })
  await holdSpaceRead(page, holds.board ?? 0)
  await page.addInitScript(sampleChrome)
  await page.goto(address)
  await expect.poll(() => streams.open()).not.toHaveLength(0)
  await pause(holds.frame)
  await streams.live(busyFrame())
  await expect(page.locator('.nav-work-list .nav-row').first()).toBeVisible()
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  return samplesOf(page)
}

/** The values a place took, in order, each once, leaving out the frames it stood empty. */
function shown(samples: Sample[], place: 'scope' | 'title'): string[] {
  const values: string[] = []
  for (const sample of samples) {
    const value = sample[place]
    if (value !== '' && values.at(-1) !== value) values.push(value)
  }
  return values
}

/** Every entry of the rail that stood in more than one place while it was drawn, and where. */
function moved(samples: Sample[]): Record<string, [number, number][]> {
  const places = new Map<string, [number, number][]>()
  for (const sample of samples)
    for (const [entry, at] of Object.entries(sample.rail)) {
      const seen = places.get(entry) ?? []
      if (!seen.some(([x, y]) => Math.abs(x - at[0]) <= 0.5 && Math.abs(y - at[1]) <= 0.5))
        seen.push(at)
      places.set(entry, seen)
    }
  return Object.fromEntries([...places].filter(([, seen]) => seen.length > 1))
}

const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })
const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

const launches = [
  {
    name: 'a launch that comes back to a project, its module list read first',
    address: '/',
    holds: { modules: 300, context: 600, frame: 400 },
    title: 'Work',
    scope: 'Example Project',
  },
  {
    name: 'a launch that comes back to a project, its projects read first',
    address: '/',
    holds: { modules: 600, context: 300, frame: 400 },
    title: 'Work',
    scope: 'Example Project',
  },
  {
    name: "a project's board opened by its address",
    address: BOARD,
    holds: { modules: 500, context: 300, frame: 400 },
    title: 'Work',
    scope: 'Example Project',
  },
  {
    name: 'Settings opened by its address',
    address: SETTINGS,
    holds: { modules: 500, context: 300, frame: 400 },
    title: 'Settings',
    scope: 'Global',
  },
] as const

for (const { name, address, holds, title, scope } of launches) {
  test(`${name} shows only final values in its chrome, and moves nothing on the rail`, async ({
    page,
  }) => {
    const samples = await launch(page, address, holds)
    const record = JSON.stringify(samples)
    // The holds did open the window: the bar stood a while before the module list put its
    // entries on the rail.
    const barAt = samples.find((sample) => sample.bar)?.t ?? Infinity
    const listedAt =
      samples.find((sample) => Object.keys(sample.rail).some((entry) => entry.startsWith('nav-')))
        ?.t ?? -Infinity
    expect(listedAt - barAt, record).toBeGreaterThan(150)
    // Each is its own finding, so a run reports every one that fails.
    expect.soft(shown(samples, 'title'), 'the title').toEqual([title])
    const scopes = shown(samples, 'scope')
    expect.soft(scopes.length, 'the scope is named').toBeGreaterThan(0)
    expect
      .soft(
        scopes.filter((value) => !value.startsWith(scope)),
        'the scope',
      )
      .toEqual([])
    expect.soft(moved(samples), 'the rail').toEqual({})
    // What waited for the list is drawn once it came.
    expect(Object.keys(samples.at(-1)?.rail ?? {}), record).toContain('nav-item:Analytics')
  })
}

test('a space read late: the groups under the list are drawn long before the board, and stay put', async ({
  page,
}) => {
  await launch(page, BOARD, { board: 2000, context: 300, frame: 400, modules: 300 })
  await expect(page.locator('.work-item-board')).toBeVisible()
  const samples = await samplesOf(page)
  const record = JSON.stringify(samples)
  const groupsAt =
    samples.find((sample) => 'nav-item:Analytics' in sample.rail)?.t ?? Number.POSITIVE_INFINITY
  const boardAt = samples.find((sample) => sample.board)?.t ?? Number.NEGATIVE_INFINITY
  // The list's frame did not wait for the space's read, so the groups under it did not either.
  expect(boardAt - groupsAt, record).toBeGreaterThan(1000)
  expect(moved(samples), 'the rail').toEqual({})
})

test('the stream the shell starts with closes once the space’s stream has delivered', async ({
  page,
}) => {
  await installBackend(page)
  // The space's stream gets its frame only when this test sends it, so the moment between
  // its opening and its frame can be looked at.
  const streams = await installLiveStreams(page, { sendOnOpen: false })
  await holdSpaceRead(page, 1000)
  await page.goto(BOARD)
  await expect.poll(() => streams.open()).toEqual(['/api/events?view=live'])
  await streams.live(busyFrame())
  await expect(page.locator('.nav-work-list .nav-row').first()).toBeVisible()
  // The space's stream opens after the read; until it delivers, the start's stream stays.
  await expect.poll(() => streams.open()).toHaveLength(2)
  await streams.live(busyFrame())
  await expect.poll(() => streams.open()).toEqual([expect.stringContaining('view=planning')])
  await expect(page.locator('.nav-work-list .nav-row').first()).toBeVisible()
  expect(await streams.made()).toEqual([
    '/api/events?view=live',
    expect.stringContaining('view=planning'),
  ])
})
