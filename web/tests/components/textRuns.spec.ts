/**
 * What a title's runs are drawn as (`textRuns.ts`): code in the monospace `code` element without
 * its backticks on the screen, broken after a `/` and never after a hyphen, which is held to the
 * character after it; a reference in a box no line breaks inside; and the rest broken after each
 * `/`. A selection copied from inside it holds the backticks of each piece of code it holds whole.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { titleRuns } from '@/shared/lib/titleRuns.ts'
import { cutRuns, drawRuns, runsDrawnIn, runsWithin, writtenText } from '@/shared/ui/textRuns.ts'

function drawn(title: string) {
  const host = document.createElement('span')
  drawRuns(host, titleRuns(title))
  return host
}

const texts = (scope: Element, selector: string) =>
  Array.from(scope.querySelectorAll(selector), (node) => node.textContent)

describe('a title drawn in runs', () => {
  it('draws its code in the `code` element without the backticks it was written between', () => {
    const host = drawn('Raise `STORE_SCHEMA_VERSION` to 18 after MAIN-12')
    expect(host.textContent).toBe('Raise STORE_SCHEMA_VERSION to 18 after MAIN-12')
    expect(texts(host, 'code')).toEqual(['STORE_SCHEMA_VERSION'])
    expect(texts(host, '.text-reference')).toEqual(['MAIN-12'])
  })

  it('gives a path in code a place to break after each `/`, and none after a hyphen', () => {
    const host = drawn('Move `web/src/work-item/a-b.ts` and `npm run-all --fix`')
    const [path, command] = host.querySelectorAll('code')
    expect(texts(path, '.slash-break')).toEqual(['web/', 'src/', 'work-item/'])
    // Each hyphen with the character after it, which no line break comes between.
    expect(texts(path, '.text-code-join')).toEqual(['-i', '-b'])
    expect(path.textContent).toBe('web/src/work-item/a-b.ts')
    // A space in code stays a place to break; a hyphen after it is held to what follows.
    expect(texts(command, '.text-code-join')).toEqual(['-a', '--f'])
    expect(command.textContent).toBe('npm run-all --fix')
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

describe('a line drawn in parts', () => {
  const pair = 'MAIN-7 Raise `STORE_SCHEMA_VERSION` · high'

  it('is cut where its end starts, as written, and never inside a piece of code', () => {
    const runs = [
      ...titleRuns('MAIN-7 Raise `STORE_SCHEMA_VERSION`'),
      { kind: 'text' as const, text: ' · high' },
    ]
    const [start, end] = cutRuns(runs, 'MAIN-7 Raise `STORE_SCHEMA_VERSION`'.length)
    expect(writtenText(start)).toBe('MAIN-7 Raise `STORE_SCHEMA_VERSION`')
    expect(start.at(-1)).toEqual({ kind: 'code', text: 'STORE_SCHEMA_VERSION' })
    expect(end).toEqual([{ kind: 'text', text: ' · high' }])
    // A cut inside a run of text cuts it; a cut inside code leaves the code whole on its side.
    expect(cutRuns(runs, 'MAIN-7 Ra'.length).map((part) => writtenText(part))).toEqual([
      'MAIN-7 Ra',
      'ise `STORE_SCHEMA_VERSION` · high',
    ])
    expect(cutRuns(runs, 'MAIN-7 Raise `STORE'.length).map((part) => writtenText(part))).toEqual([
      'MAIN-7 Raise `STORE_SCHEMA_VERSION`',
      ' · high',
    ])
  })

  it('is found by its parts in order when no one part holds all its words', () => {
    const anchor = document.createElement('span')
    const [first, second] = [document.createElement('span'), document.createElement('span')]
    anchor.append(first, second)
    drawRuns(first, titleRuns('MAIN-7 Raise `STORE_SCHEMA_VERSION`'))
    drawRuns(second, [{ kind: 'text', text: ' · high' }])
    expect(writtenText(runsDrawnIn(anchor, pair) ?? [])).toBe(pair)
    expect(runsDrawnIn(anchor, 'MAIN-7 Raise STORE_SCHEMA_VERSION · high')).toBeNull()
  })

  it('lays runs into the place a sentence of the interface keeps for them', () => {
    const runs = titleRuns('Raise `X`')
    expect(runsWithin('Task: \u{E000}', '\u{E000}', runs)).toEqual([
      { kind: 'text', text: 'Task: ' },
      ...runs,
    ])
    expect(writtenText(runsWithin('«\u{E000}» задача', '\u{E000}', runs))).toBe(
      '«Raise `X`» задача',
    )
    // A sentence without the mark is its own words.
    expect(runsWithin('Task', '\u{E000}', runs)).toEqual([{ kind: 'text', text: 'Task' }])
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
    const word = host.querySelector('code')?.firstChild
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
