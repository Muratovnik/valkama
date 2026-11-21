/**
 * What a hint aside of a list or at a chart's mark stands against, read from the page: the list
 * a container declares once, the row its element stands in, the box past the list's edge or beside
 * the row, and the mark an element declares. The
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
    expect(hintRowOf(one('.first .title'), container)).toBe(one('.first'))
    expect(hintRowOf(one('.first .pin'), container)).toBe(one('.first'))
    expect(hintRowOf(one('.second .pin'), container)).toBe(one('.second'))
    expect(hintRowOf(one('.second .title'), container)).toBe(one('.second'))
    expect(hintRowOf(one('.second .line'), container)).toBe(one('.second'))
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
    expect(hintRowOf(one('.first .title'), one('.rail'))).toBe(one('.first'))
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

  it('stands under the whole of a chart’s legend from its entry’s start, whatever line it is on', () => {
    // A legend of three entries in two lines over a plot: two on the first line, one on the next.
    document.body.innerHTML = `
      <ul class="legend" data-hint-list="legend">
        <li><span class="key a">A</span></li><li><span class="key b">B</span></li>
        <li><span class="key c">C</span></li>
      </ul>`
    at(one('.legend'), [500, 200, 600, 48])
    at(one('.a'), [500, 200, 240, 20])
    at(one('.b'), [760, 200, 200, 20])
    at(one('.c'), [500, 228, 300, 20])
    const under = (selector: string) => {
      const place = hintPlaceOf(one<HTMLElement>(selector), { kind: 'detail' }, 200)
      expect(place).toMatchObject({ align: 'start', aside: true, side: 'bottom', through: true })
      const { left, right, top, bottom } = (
        place.reference as { getBoundingClientRect: () => DOMRect }
      ).getBoundingClientRect()
      return { left, right, top, bottom }
    }
    // Each from its own start across its own span, its foot the legend's: under the second line.
    expect(under('.a')).toEqual({ left: 500, right: 740, top: 200, bottom: 248 })
    expect(under('.b')).toEqual({ left: 760, right: 960, top: 200, bottom: 248 })
    expect(under('.c')).toEqual({ left: 500, right: 800, top: 228, bottom: 248 })
  })

  it('stands beside the mark its element declares, or the one its area holds, level with its top', () => {
    document.body.innerHTML = `
      <div class="bars">
        <div class="slot one" data-tooltip-area><span class="column"></span><span class="stack" data-hint-mark></span></div>
        <div class="row two"><span class="name"></span><span class="bar" data-hint-mark></span></div>
        <span class="name three" data-hint-mark></span>
      </div>`
    at(one('.bars'), [100, 50, 800, 200])
    at(one('.one'), [100, 50, 200, 200])
    at(one('.one .column'), [100, 50, 200, 200])
    at(one('.one .stack'), [190, 150, 20, 100])
    at(one('.two'), [300, 50, 400, 20])
    at(one('.two .bar'), [400, 56, 60, 8])
    at(one('.three'), [300, 80, 160, 20])
    const edges = (selector: string) => {
      const place = hintPlaceOf(one<HTMLElement>(selector), { kind: 'detail' }, 200)
      expect(place).toMatchObject({ align: 'start', aside: true, mark: true, side: 'right' })
      const reference = place.reference as { getBoundingClientRect: () => DOMRect }
      const { left, right, top } = reference.getBoundingClientRect()
      return { left, right, top }
    }
    // A period's stack, which stands beside the period that takes the pointer, in its area.
    expect(edges('.one .column')).toEqual({ left: 190, right: 210, top: 150 })
    // A ranked row's bar, inside the row.
    expect(edges('.two')).toEqual({ left: 400, right: 460, top: 56 })
    // A small chart's name, its own mark.
    expect(edges('.three')).toEqual({ left: 300, right: 460, top: 80 })
  })

  it('stands over a mark drawn with no height at its top right, as at a point on its floor', () => {
    document.body.innerHTML = `
      <span class="period"><span class="floor" data-hint-mark></span></span>`
    at(one('.period'), [400, 100, 40, 48])
    at(one('.floor'), [400, 148, 40, 0])
    const place = hintPlaceOf(one<HTMLElement>('.period'), { kind: 'detail' }, 160)
    const reference = place.reference as { getBoundingClientRect: () => DOMRect }
    const { left, right, top, bottom } = reference.getBoundingClientRect()
    expect({ ...place, reference: undefined }).toEqual({
      align: 'start',
      aside: true,
      corner: 'right',
      mark: true,
      // The box that declares the mark, whose change asks for the place again.
      markElement: one('.floor'),
      through: true,
      reference: undefined,
      side: 'top',
    })
    expect({ left, right, top, bottom }).toEqual({ left: 446, right: 446, top: 148, bottom: 148 })
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
      place: {
        align: 'start',
        aside: true,
        corner: 'right',
        mark: true,
        markElement: one('.one .mark'),
        through: true,
        reference: undefined,
        side: 'top',
      },
      edge: { left: 212, right: 212, top: 160, bottom: 172 },
    })
    // 700 - 606 - 6 = 88 on the right: the left, mirrored.
    expect(corner('.two')).toEqual({
      place: {
        align: 'end',
        aside: true,
        corner: 'left',
        mark: true,
        markElement: one('.two .mark'),
        through: true,
        reference: undefined,
        side: 'top',
      },
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
