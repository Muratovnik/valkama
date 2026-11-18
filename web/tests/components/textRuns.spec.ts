/**
 * What a title's runs are drawn as (`textRuns.ts`): code in the monospace `code` element without
 * its backticks on the screen, each of its words a box that breaks after a `/` and not at its
 * hyphen, a reference in a box no line breaks inside, and the rest broken after each `/`. A
 * selection copied from inside it holds the backticks of each piece of code it holds whole.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { titleRuns } from '@/shared/lib/titleRuns.ts'
import { drawRuns, runsDrawnIn, writtenText } from '@/shared/ui/textRuns.ts'

function drawn(title: string) {
  const host = document.createElement('span')
  drawRuns(host, titleRuns(title))
  return host
}

describe('a title drawn in runs', () => {
  it('draws its code in the `code` element without the backticks it was written between', () => {
    const host = drawn('Raise `STORE_SCHEMA_VERSION` to 18 after MAIN-12')
    expect(host.textContent).toBe('Raise STORE_SCHEMA_VERSION to 18 after MAIN-12')
    const codes = host.querySelectorAll('code')
    expect([...codes].map((code) => code.textContent)).toEqual(['STORE_SCHEMA_VERSION'])
    expect([...codes[0].querySelectorAll('.whole-word')].map((word) => word.textContent)).toEqual([
      'STORE_SCHEMA_VERSION',
    ])
    expect([...host.querySelectorAll('.text-reference')].map((one) => one.textContent)).toEqual([
      'MAIN-12',
    ])
  })

  it('makes each piece of a path in code a box of its own, with a place to break after its `/`', () => {
    const host = drawn('Move `web/src/work-item/a-b.ts` and `npm run build`')
    const [path, command] = host.querySelectorAll('code')
    expect([...path.querySelectorAll('.whole-word')].map((word) => word.textContent)).toEqual([
      'web/',
      'src/',
      'work-item/',
      'a-b.ts',
    ])
    expect(path.querySelectorAll('.slash-break')).toHaveLength(3)
    // Words of code break at their spaces, which stay text between the boxes.
    expect([...command.querySelectorAll('.whole-word')].map((word) => word.textContent)).toEqual([
      'npm',
      'run',
      'build',
    ])
    expect(command.textContent).toBe('npm run build')
  })

  it('draws a title with no code as it did: a reference whole, the rest broken after a `/`', () => {
    const host = drawn('Split docs/plans/a.md for MAIN-3')
    expect(host.querySelector('code')).toBeNull()
    expect([...host.querySelectorAll('.slash-break')].map((piece) => piece.textContent)).toEqual([
      'Split docs/',
      'plans/',
    ])
    expect(host.textContent).toBe('Split docs/plans/a.md for MAIN-3')
  })

  it('draws again only when the runs change, and is found by what it holds as written', () => {
    const host = drawn('Bump `VERSION`')
    const code = host.querySelector('code')
    drawRuns(host, titleRuns('Bump `VERSION`'))
    expect(host.querySelector('code')).toBe(code)
    drawRuns(host, titleRuns('Bump `RELEASE`'))
    expect(host.querySelector('code')).not.toBe(code)
    expect(host.textContent).toBe('Bump RELEASE')

    const anchor = document.createElement('button')
    anchor.append(host)
    expect(runsDrawnIn(anchor, 'Bump `RELEASE`')?.map((run) => run.kind)).toEqual(['text', 'code'])
    expect(writtenText(runsDrawnIn(anchor, 'Bump `RELEASE`') ?? [])).toBe('Bump `RELEASE`')
    // A hint whose words are not the drawn title's is laid as its own text.
    expect(runsDrawnIn(anchor, 'Bump RELEASE')).toBeNull()
  })
})

/** What a copy of the selection `select` sets puts on the clipboard, and whether it took it. */
function copied(host: HTMLElement, select: (range: Range) => void) {
  const range = document.createRange()
  select(range)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  const data = new DataTransfer()
  const event = new ClipboardEvent('copy', {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  })
  // A copy goes to the element the selection starts in, as a browser sends it.
  const start = range.startContainer
  const target = start instanceof Element ? start : (start.parentElement ?? host)
  target.dispatchEvent(event)
  return { refused: event.defaultPrevented, text: data.getData('text/plain') }
}

describe('a selection copied from a title drawn in runs', () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  it('is the title as written, backticks round each piece of code it holds whole', () => {
    const title = 'Raise `STORE_SCHEMA_VERSION` in `web/src/a-b.ts` to 18'
    const host = drawn(title)
    document.body.append(host)
    expect(copied(host, (range) => range.selectNodeContents(host))).toEqual({
      refused: true,
      text: title,
    })
  })

  it('leaves a piece of code it cuts without backticks, and the rest to the browser', () => {
    const host = drawn('Raise `STORE_SCHEMA_VERSION` to 18')
    document.body.append(host)
    const word = host.querySelector('code .whole-word')?.firstChild
    if (!word) throw new Error('no code drawn')
    // Part of the code alone: the browser copies what it shows.
    expect(
      copied(host, (range) => {
        range.setStart(word, 0)
        range.setEnd(word, 5)
      }).refused,
    ).toBe(false)
    // From the words before it into the code, and no further than its middle.
    const before = host.firstChild
    if (!before) throw new Error('no words drawn')
    expect(
      copied(host, (range) => {
        range.setStart(before, 0)
        range.setEnd(word, 5)
      }).refused,
    ).toBe(false)
  })
})
