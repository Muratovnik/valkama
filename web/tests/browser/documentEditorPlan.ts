import type { Locator, Page } from '@playwright/test'

/**
 * The plan the server answers for a file, as a browser asks for it: one link that opens
 * the file in VS Code at its line, or an explanation of why nothing opens. What the page
 * asked and what it copied are kept in the page, so nothing reaches the system's
 * clipboard or starts a program; `window.open` is the browser doubles' to record.
 */

export const EDITOR = 'Open in VS Code'

const FOLDER = 'C:/work/demo'

function filePlan(query: URLSearchParams, refuse: boolean) {
  const path = query.get('path') ?? ''
  const line = query.has('line') ? Number(query.get('line')) : null
  const plan = {
    target: { kind: 'file', project: query.get('project') ?? '', path, line },
    surface: 'browser',
    client: '',
    state: 'none',
    place: { opened_in: '', opened_host: '', source: 'none' },
  }
  if (refuse)
    return {
      ...plan,
      opens: null,
      one_action: false,
      steps: [{ kind: 'explain', reason: 'path-refused', code: 'not_found' }],
    }
  const absolute = `${FOLDER}/${path}`
  const at = line === null ? '' : `:${line}:1`
  return {
    ...plan,
    opens: { opened_in: 'ide', opened_host: 'vscode', source: 'fallback', missed: '' },
    one_action: true,
    steps: [
      {
        kind: 'open-file',
        ide: 'vscode',
        path: absolute,
        line,
        link: `vscode://file/${absolute}${at}`,
      },
    ],
  }
}

/** Answers every file plan, opening or refusing, and gives back what was asked. */
export async function answerFilePlans(page: Page, refuse = false) {
  const asked: URLSearchParams[] = []
  await page.route('**/api/open-plan*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    await route.fulfill({ json: filePlan(query, refuse) })
  })
  return asked
}

/** What a plan was asked about a file, as the plan reads it. */
export const fileAsked = (query: URLSearchParams | undefined) => ({
  target: query?.get('target'),
  project: query?.get('project'),
  path: query?.get('path'),
  line: query?.get('line'),
  surface: query?.get('surface'),
})

/** What the page put on the clipboard, kept in the page. */
export async function keepCopies(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })
    Object.assign(window, { copied })
  })
}

export const copiedIn = (page: Page) =>
  page.evaluate(() => (window as unknown as { copied: string[] }).copied)

export const openedIn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? [])

/** The shell's notice, which lies over every host the head stands in. */
export const noticeOf = (page: Page) => page.locator('.notice-message')

/**
 * How much room a block a link sent the reader to leaves its ring at each side of the
 * scroller it stands in, in whole pixels. Null while no ring is drawn on it.
 */
export const ringRoom = (target: Locator) =>
  target.evaluate((block) => {
    const scroller = block.closest('.document-body')
    if (!scroller || !block.matches(':focus-visible')) return null
    const style = getComputedStyle(block)
    const ring = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
    const box = block.getBoundingClientRect()
    const edge = scroller.getBoundingClientRect()
    return {
      start: Math.round(box.left - ring - edge.left),
      end: Math.round(edge.right - (box.right + ring)),
    }
  })
