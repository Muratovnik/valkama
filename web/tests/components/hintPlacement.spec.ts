/**
 * What a hint aside of a list stands against, read from the page: the list a container declares
 * once, the row its element stands in, and the box past the list's edge or beside the row. The
 * boxes are laid out by hand, since this DOM lays out nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hintListOf, hintPlaceOf, hintRowOf } from '@/shared/ui/hintPlacement.ts'

/** Gives an element the box it would have, in the window's coordinates. */
function at(element: Element, [left, top, width, height]: [number, number, number, number]) {
  element.getBoundingClientRect = () => new DOMRect(left, top, width, height)
}

const one = <T extends Element>(selector: string) => {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`no ${selector}`)
  return found
}

/**
 * A rail 260px wide of two rows 28px tall, each a link holding a number and a title on one line,
 * with a pin at its end; the second row has a second line under its words.
 */
function rail() {
  document.body.innerHTML = `
    <aside class="rail" data-hint-list="rows">
      <ul>
        <li class="first"><div class="row">
          <a class="link"><span class="number">1</span><span class="title">One</span></a>
          <button class="pin"></button>
        </div></li>
        <li class="second"><div class="row">
          <a class="link"><span class="words"><span class="title">Two</span></span><span class="line">later</span></a>
          <button class="pin"></button>
        </div></li>
      </ul>
    </aside>`
  at(one('.rail'), [0, 0, 260, 800])
  at(one('ul'), [8, 100, 244, 72])
  at(one('.first'), [8, 100, 244, 28])
  at(one('.first .row'), [8, 100, 244, 28])
  at(one('.first .link'), [8, 100, 200, 28])
  at(one('.first .number'), [12, 109, 20, 9])
  at(one('.first .title'), [40, 109, 120, 9])
  at(one('.first .pin'), [220, 104, 20, 20])
  at(one('.second'), [8, 128, 244, 44])
  at(one('.second .row'), [8, 128, 244, 44])
  at(one('.second .link'), [8, 128, 200, 44])
  at(one('.second .words'), [40, 132, 160, 16])
  at(one('.second .title'), [40, 135, 60, 9])
  at(one('.second .line'), [40, 152, 160, 14])
  at(one('.second .pin'), [220, 140, 20, 20])
}

beforeEach(() => {
  // A window 1440px wide, with room on the right of the rail.
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: 1440,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a hint aside of a list', () => {
  it('finds the list its container declares, and nothing outside one', () => {
    rail()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p class="free">x</p><div data-hint-list="other"><b>y</b></div>',
    )
    expect(hintListOf(one('.title'))).toEqual({ container: one('.rail'), list: 'rows' })
    expect(hintListOf(one('.free'))).toBeNull()
    expect(hintListOf(one('b'))).toBeNull()
  })

  it('takes for the row the list’s item, on a row of one line or of two', () => {
    rail()
    const container = one<HTMLElement>('.rail')
    // On a one-line row the title, the number and the pin stand side by side, so the row is the
    // list's item. On a row of two lines the words have the second line under them, but they
    // stand inside the link that stands beside the pin: a line of the row, not a row.
    expect(hintRowOf(one('.first .title'), container, 'rows')).toBe(one('.first'))
    expect(hintRowOf(one('.first .pin'), container, 'rows')).toBe(one('.first'))
    expect(hintRowOf(one('.second .pin'), container, 'rows')).toBe(one('.second'))
    expect(hintRowOf(one('.second .title'), container, 'rows')).toBe(one('.second'))
    expect(hintRowOf(one('.second .line'), container, 'rows')).toBe(one('.second'))
  })

  it('stands level with the top of a row of two lines for each of its lines', () => {
    rail()
    for (const selector of ['.second .title', '.second .line', '.second .pin']) {
      const reference = hintPlaceOf(one(selector), { kind: 'detail' }, 120).reference as {
        getBoundingClientRect: () => DOMRect
      }
      expect(reference.getBoundingClientRect().top).toBe(128)
    }
  })

  it('takes no word kept for a screen reader alone for a neighbour', () => {
    rail()
    one('.first').insertAdjacentHTML('afterend', '<li class="unseen">hidden</li>')
    at(one('.unseen'), [8, 110, 1, 1])
    expect(hintRowOf(one('.first .title'), one('.rail'), 'rows')).toBe(one('.first'))
  })

  it('stands past the list’s edge, level with the row’s top, for a title and a pin alike', () => {
    rail()
    for (const selector of ['.first .title', '.first .pin']) {
      const place = hintPlaceOf(one(selector), { kind: 'name' }, 120)
      expect(place).toMatchObject({ align: 'start', aside: true, side: 'right' })
      const reference = place.reference as { getBoundingClientRect: () => DOMRect }
      const { left, right, top, height } = reference.getBoundingClientRect()
      expect({ left, right, top, height }).toEqual({ left: 0, right: 260, top: 100, height: 28 })
    }
  })

  it('stands beside its own row in a list of rows across', () => {
    document.body.innerHTML = `
      <div class="bars" data-hint-list="columns">
        <div class="slot one"><span class="column"></span><span class="stack"></span></div>
        <div class="slot two"><span class="column"></span><span class="stack"></span></div>
      </div>`
    at(one('.bars'), [100, 50, 400, 200])
    at(one('.one'), [100, 50, 40, 200])
    at(one('.one .column'), [100, 50, 40, 200])
    at(one('.one .stack'), [110, 150, 20, 100])
    at(one('.two'), [140, 50, 40, 200])
    const column = one<HTMLElement>('.one .column')
    expect(hintRowOf(column, one('.bars'), 'columns')).toBe(one('.one'))
    const place = hintPlaceOf(column, { kind: 'detail' }, 200)
    expect(place).toMatchObject({ align: 'start', aside: true, side: 'right' })
    const reference = place.reference as { getBoundingClientRect: () => DOMRect }
    const { left, right, top } = reference.getBoundingClientRect()
    expect({ left, right, top }).toEqual({ left: 100, right: 140, top: 50 })
  })

  it('stands beside the bar its row draws, level with the bar’s top, or the row’s where none is drawn', () => {
    document.body.innerHTML = `
      <div class="bars" data-hint-list="columns">
        <div class="slot one"><span class="column"></span><span class="stack" data-hint-bar></span></div>
        <div class="slot two"><span class="column"></span><span class="stack" data-hint-bar></span></div>
      </div>`
    at(one('.bars'), [100, 50, 400, 200])
    at(one('.one'), [100, 50, 200, 200])
    at(one('.one .column'), [100, 50, 200, 200])
    at(one('.one .stack'), [190, 150, 20, 100])
    at(one('.two'), [300, 50, 200, 200])
    at(one('.two .column'), [300, 50, 200, 200])
    // A period of nothing: its stack is drawn no taller than nothing, on the floor.
    at(one('.two .stack'), [390, 250, 20, 0])
    const edges = (selector: string) => {
      const place = hintPlaceOf(one<HTMLElement>(selector), { kind: 'detail' }, 200)
      expect(place).toMatchObject({ align: 'start', aside: true })
      const reference = place.reference as { getBoundingClientRect: () => DOMRect }
      const { left, right, top } = reference.getBoundingClientRect()
      return { left, right, top }
    }
    expect(edges('.one .column')).toEqual({ left: 190, right: 210, top: 150 })
    expect(edges('.two .column')).toEqual({ left: 390, right: 410, top: 50 })
  })

  it('stands at a corner of the point its element holds, as a line past the mark’s edge', () => {
    document.body.innerHTML = `
      <figure class="line" data-hint-frame>
        <span class="step one"><span class="mark" data-hint-point></span></span>
        <span class="step two"><span class="mark" data-hint-point></span></span>
      </figure>`
    at(one('.line'), [100, 100, 600, 120])
    at(one('.one'), [200, 120, 300, 96])
    at(one('.one .mark'), [194, 160, 12, 12])
    at(one('.two'), [600, 120, 24, 96])
    at(one('.two .mark'), [594, 140, 12, 12])
    const corner = (selector: string) => {
      const place = hintPlaceOf(one<HTMLElement>(selector), { kind: 'detail' }, 180)
      const reference = place.reference as { getBoundingClientRect: () => DOMRect }
      const { left, right, top, bottom } = reference.getBoundingClientRect()
      return { place: { ...place, reference: undefined }, edge: { left, right, top, bottom } }
    }
    // Room on the right inside the line's frame: 700 - 206 - 6 = 488 for a hint 180px wide.
    expect(corner('.one')).toEqual({
      place: { align: 'start', aside: true, corner: 'right', reference: undefined, side: 'top' },
      edge: { left: 212, right: 212, top: 160, bottom: 172 },
    })
    // 700 - 606 - 6 = 88 on the right: the left, mirrored.
    expect(corner('.two')).toEqual({
      place: { align: 'end', aside: true, corner: 'left', reference: undefined, side: 'top' },
      edge: { left: 588, right: 588, top: 140, bottom: 152 },
    })
  })

  it('is placed against its own element outside a list', () => {
    document.body.innerHTML = '<p><time class="free">x</time></p>'
    const element = one<HTMLElement>('.free')
    at(element, [100, 100, 40, 20])
    expect(hintPlaceOf(element, { kind: 'detail' }, 200)).toEqual({
      align: 'start',
      aside: false,
      reference: element,
      side: 'bottom',
    })
  })
})
