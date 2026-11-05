import type { Page } from '@playwright/test'

/** One stretch of time the loading block could be seen, in the page's milliseconds. */
interface LoadingSpan {
  /** From the moment the watch was started. */
  from: number
  to: number
  /** Where it stood: the closest element that names its place. */
  where: string
}

export interface LoadingWatch {
  /**
   * Every height a busy panel stood at, drawn or still waiting to be: one value means the
   * place it holds neither collapsed nor grew when it came into view.
   */
  heights: number[]
  /** When the page was last pressed, on the same clock; 0, the watch's start, before that. */
  pressedAt: number
  spans: LoadingSpan[]
}

/**
 * Runs in the page: from now on, note every stretch of time a loading block is seen.
 *
 * Seen means drawn: a busy panel whose dots or title the browser would paint, with no
 * `opacity: 0` and no `visibility: hidden` on them or above them. A panel kept in the
 * tree while its picture waits is not seen, which is the point. The page is sampled on
 * every mutation and on every frame, so a block that lived for one frame is caught; the
 * clock is the page's own, so a span is what the operator saw and not what a round trip
 * to the test made of it.
 */
function startWatch() {
  const host = window as unknown as { loadingWatch?: LoadingWatch & { sample: () => void } }
  const start = performance.now()
  const watch: LoadingWatch & { sample: () => void } = {
    heights: [],
    pressedAt: 0,
    spans: [],
    sample: () => {},
  }
  let open: LoadingSpan | null = null
  // This runs in the page, where nothing from the module's scope is defined.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const drawn = (node: Element) =>
    node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  watch.sample = () => {
    for (const panel of document.querySelectorAll('.platform-state-panel[aria-busy="true"]')) {
      const height = Math.round(panel.getBoundingClientRect().height)
      if (!watch.heights.includes(height)) watch.heights.push(height)
    }
    const seen = [
      ...document.querySelectorAll(
        '.platform-state-panel[aria-busy="true"] :is(.work-dots, .platform-state-title)',
      ),
    ].find((node) => drawn(node))
    const at = performance.now() - start
    if (seen === undefined) {
      if (open !== null) open.to = at
      open = null
      return
    }
    if (open !== null) {
      open.to = at
      return
    }
    const place = seen.closest<HTMLElement>('[data-scroll-owner], .workspace-stage, .drawer, main')
    open = {
      from: at,
      to: at,
      where: place?.dataset.scrollOwner ?? place?.className.split(' ')[0] ?? 'page',
    }
    watch.spans.push(open)
  }
  host.loadingWatch = watch
  document.addEventListener(
    'pointerdown',
    () => {
      watch.pressedAt = performance.now() - start
    },
    true,
  )
  new MutationObserver(watch.sample).observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  })
  const frame = () => {
    watch.sample()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/**
 * Watch the page for a loading block, from now on or, with `fromLoad`, from the next
 * page it loads. What it answers is the watch so far.
 */
export async function watchLoading(page: Page, { fromLoad = false } = {}) {
  if (fromLoad) await page.addInitScript(startWatch)
  else await page.evaluate(startWatch)
  return () =>
    page.evaluate(() => {
      const host = window as unknown as { loadingWatch?: LoadingWatch & { sample: () => void } }
      host.loadingWatch?.sample()
      const { heights = [], pressedAt = 0, spans = [] } = host.loadingWatch ?? {}
      return structuredClone({ heights, pressedAt, spans })
    })
}
