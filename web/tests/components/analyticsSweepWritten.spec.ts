/**
 * The Analytics sweep reads a text the page draws in runs as it is written (`written` in
 * `tests/sweep/sweepInPage.ts`), since a hint's words and the names the API gives are written so:
 * a task's title holding code is drawn without its backticks (`textRuns.ts`), and read as drawn it
 * was never the words it is marked with. The runs here are drawn by the page's own code, installed
 * as the sweep installs its helpers in a page.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { titleRuns } from '@/shared/lib/titleRuns.ts'
import { drawRuns } from '@/shared/ui/textRuns.ts'

import { helperScript } from '../sweep/sweepInPage.ts'

/** A title as written, with a piece of code holding a slash, which the runs draw in pieces. */
const TITLE = 'MAIN-7 Raise `server/STORE_SCHEMA` before the move'

/** An element holding `title` drawn in runs, and `after` as plain text beside them. */
function drawn(title: string, after = ''): HTMLElement {
  const element = document.createElement('a')
  const name = document.createElement('span')
  drawRuns(name, titleRuns(title))
  element.append(name, after)
  document.body.append(element)
  return element
}

beforeAll(() => {
  // eslint-disable-next-line sonarjs/code-eval -- the script the sweep installs in a page, its own
  new Function(helperScript())()
})

describe('the sweep reads drawn runs as written', () => {
  it('puts each piece of code back between its backticks, and leaves the rest as it reads', () => {
    const line = drawn(TITLE, '+2 h')
    expect(line.querySelector('code')).not.toBeNull()
    expect(line.textContent).not.toContain('`')
    expect(window.sweepHelpers.written(line)).toBe(`${TITLE}+2 h`)
  })

  it('reads a text with no code, and code drawn outside runs, as the page shows it', () => {
    const plain = drawn('MAIN-8 Tidy up', '+1 h')
    const loose = document.createElement('p')
    loose.innerHTML = 'Run <code>npm test</code> first'
    expect(window.sweepHelpers.written(plain)).toBe('MAIN-8 Tidy up+1 h')
    expect(window.sweepHelpers.written(loose)).toBe('Run npm test first')
  })

  it("expects no hint of a name drawn whole, marked with its title's words alone", () => {
    // A ranked row's name with no detail: its hint is its words, held back until they are cut.
    const row = drawn(TITLE)
    row.dataset.tooltip = TITLE
    row.dataset.tooltipKind = 'detail'
    row.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 20 })
    row.checkVisibility = () => true
    expect(window.sweepHelpers.speaks(row)).toBe(false)
  })

  it('finds the whole words over a cut name drawn in runs to be its own', () => {
    // An overview's changes line: the name and its amount, and over the cut name its whole words,
    // drawn in the same runs on the hint's surface.
    const line = drawn(TITLE, '+2 h')
    line.dataset.tooltip = TITLE
    const surface = drawn(TITLE)
    const flat = window.sweepHelpers.flat
    const says = window.sweepHelpers.hintSays(flat(window.sweepHelpers.written(surface)), [
      {
        id: 'line',
        words: flat(line.dataset.tooltip),
        own: flat(window.sweepHelpers.written(line)),
      },
      { id: 'other', words: flat('MAIN-9 Other'), own: flat('MAIN-9 Other+1 h') },
    ])
    expect(says).toEqual(['line'])
  })
})
