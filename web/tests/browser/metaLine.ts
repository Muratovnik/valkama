import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/**
 * The narrowest a name may be drawn beside the time, in widths of the digit zero: about
 * seventeen lowercase letters in the interface font, so a word of an agent's name such as
 * "retrospective" stands whole beside the time.
 */
const NAME_MIN_CH = 14

export type DatePlace = 'first line' | 'own line'

/**
 * Who wrote an entry and when, beside a name too long to share one line with the time. The
 * time stands at the end of the name's first line while the name keeps at least
 * `NAME_MIN_CH` there, or as much as the whole name takes if that is less; with less room
 * it takes a line of its own under the name, starting where the name starts, and the name
 * the whole width. In either place the name breaks inside a word only where that word does
 * not fit its line. A name squeezed into what the time left over once stood a word or two to
 * a line, and a time on its own line held to the end of the words stood in the middle of an
 * entry's head, under nothing, wherever icons took the rest of that line. A name with an
 * agent's session is owed its whole width with the session's start, which is one with it
 * (`expectSessionWithName`), so beside a time it does not fit with it takes a line of its own.
 * So is a phrase that says who, «Answered by agent kolo».
 */
export async function expectDateHeld(meta: Locator, where: string): Promise<DatePlace> {
  const line = await meta.evaluate((root, minCh) => {
    const [who, when] = [root.firstElementChild, root.lastElementChild]
    if (!who || !when || who === when) throw new Error('A name and a time')
    const box = root.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(who)
    const whose = [...range.getClientRects()].filter((rect) => rect.width > 0)
    // The minimum measured in the name's own font, apart from whatever rule applies it.
    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(minCh)
    probe.style.whiteSpace = 'nowrap'
    who.append(probe)
    const minimum = probe.getBoundingClientRect().width
    probe.remove()
    // A line may break between words and after a hyphen; a piece cut anywhere else is a
    // word broken, and it is recorded with the width it would need on one line.
    const broken: { piece: string; width: number }[] = []
    const walker = document.createTreeWalker(who, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(/[^\s-]+-?/g)) {
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
        if (new Set(rects.map((rect) => Math.round(rect.top))).size < 2) continue
        broken.push({ piece: match[0], width: rects.reduce((sum, rect) => sum + rect.width, 0) })
      }
    }
    const whenBox = when.getBoundingClientRect()
    return {
      broken,
      gap: Number.parseFloat(getComputedStyle(root).columnGap) || 0,
      minimum,
      // The name laid out end to end, as long as it would be on one line.
      nameWidth: whose.reduce((sum, rect) => sum + rect.width, 0),
      nameTop: whose[0]?.top ?? Number.NaN,
      nameBottom: Math.max(...whose.map((rect) => rect.bottom)),
      left: box.left,
      nameLeft: Math.min(...whose.map((rect) => rect.left)),
      right: box.right,
      unit: who.classList.contains('is-unit'),
      whenLeft: whenBox.left,
      whenRight: whenBox.right,
      whenTop: whenBox.top,
      whenWidth: whenBox.width,
      whoWidth: who.getBoundingClientRect().width,
      width: box.width,
    }
  }, NAME_MIN_CH)
  expect(
    line.nameWidth + line.gap + line.whenWidth,
    `${where}: the name and the date do not fit one line`,
  ).toBeGreaterThan(line.width)
  const place: DatePlace = Math.abs(line.whenTop - line.nameTop) <= 2 ? 'first line' : 'own line'
  const room = line.width - line.whenWidth - line.gap
  const owed = line.unit ? line.nameWidth : Math.min(line.minimum, line.nameWidth)
  // A pixel either side of the threshold is the browser's rounding, not a decision.
  if (Math.abs(room - owed) > 1) {
    expect(place, `${where}: the date's line, with ${room}px left beside it`).toBe(
      room > owed ? 'first line' : 'own line',
    )
  }
  if (place === 'first line') {
    expect(line.whoWidth, `${where}: the name's room beside the date`).toBeGreaterThanOrEqual(
      owed - 1,
    )
    expect(Math.abs(line.whenRight - line.right), `${where}: the date's end`).toBeLessThanOrEqual(1)
  } else {
    expect(line.whenTop, `${where}: the date under the name`).toBeGreaterThanOrEqual(
      line.nameBottom - 1,
    )
    expect(line.whoWidth, `${where}: the name's room above the date`).toBeGreaterThanOrEqual(
      Math.min(line.width, line.nameWidth) - 1,
    )
    expect(Math.abs(line.whenLeft - line.left), `${where}: the date's start`).toBeLessThanOrEqual(1)
    expect(Math.abs(line.nameLeft - line.left), `${where}: the name's start`).toBeLessThanOrEqual(1)
  }
  expect(
    line.broken.filter(({ width }) => width <= line.whoWidth),
    `${where}: words broken that fit the name's line`,
  ).toEqual([])
  return place
}

/**
 * How an entry's head draws the session its agent wrote from, by a Range over the id's own
 * characters: what is drawn, on how many lines, in what font, whether it stays inside the head,
 * the whole id its tooltip or its link carries, and how tall each line of the name stands. A
 * head that names no session draws nothing of one and has its name's lines all the same.
 */
export const sessionHead = (head: Locator) =>
  head.evaluate((root) => {
    const who = root.querySelector('.meta-who')
    if (!who) throw new Error('A name')
    const session = root.querySelector<HTMLElement>('.meta-session')
    const link = session?.querySelector('a') ?? null
    const box = root.getBoundingClientRect()
    const range = document.createRange()
    const drawnIn = (node: Node) => {
      range.selectNodeContents(node)
      return [...range.getClientRects()].filter((rect) => rect.width > 0)
    }
    // Lines by their tops, apart by more than half a letter: words of two fonts on one line
    // start a pixel or so apart.
    const lines = (rects: DOMRect[]) => {
      const half = Number.parseFloat(getComputedStyle(who).fontSize) / 2
      const tops = rects.map((rect) => rect.top).sort((a, b) => a - b)
      return tops.filter((top, index) => index === 0 || top - tops[index - 1] > half).length
    }
    const rects = session ? drawnIn(session) : []
    const text = link ?? session
    return {
      drawn: session?.textContent ?? '',
      font: text ? getComputedStyle(text).fontFamily : '',
      inside: rects.every((rect) => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5),
      lines: lines(rects),
      lineHeight: who.getBoundingClientRect().height / lines(drawnIn(who)),
      link: link && { role: link.getAttribute('role'), title: link.title },
      overflow: root.scrollWidth - root.clientWidth,
      title: session?.title ?? '',
    }
  })

type UnitPlace = 'its line' | 'own line'
type StartPlace = 'after the name' | 'own line'

/**
 * An agent's name and its session's start, one unit in an entry's head: the start stands on the
 * name's last line, right after it, a space apart; the date stands on that line after the start,
 * or, where the pair does not fit beside it, on a line of its own under it, starting where the
 * name starts. Never the date on the first line with the start on a line below it, which is how
 * «kolo» stood over «019a2b3c-4d5e» beside the date on a phone. The start takes a line of its
 * own under the name only where even the name's last unbreakable piece, after its last space or
 * hyphen, with the no-break space and the start is wider than the head's column, as beside three
 * icons at 320; that width is measured apart from the layout under test. Lines are counted by what is drawn: a rect starts a line
 * when it begins below the middle of the line before, since the start, in the metadata font,
 * stands a pixel lower than the name on the same line.
 */
export async function expectSessionWithName(
  meta: Locator,
  where: string,
): Promise<{ date: UnitPlace; start: StartPlace }> {
  const drawn = await meta.evaluate((root) => {
    const who = root.querySelector('.meta-who')
    const session = root.querySelector('.meta-session')
    const when = root.querySelector('.meta-when')
    if (!who || !session || !when) throw new Error('A name, a session and a time')
    const range = document.createRange()
    const drawnNow = () => [...range.getClientRects()].filter((rect) => rect.width > 0)
    // The name, from its first letter to its last, apart from the space after it.
    const texts: Text[] = []
    const walker = document.createTreeWalker(who, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (!session.contains(node) && node.textContent?.trim()) texts.push(node as Text)
    const [first, last] = [texts[0], texts.at(-1)]
    if (!first || !last) throw new Error('No name')
    range.setStart(first, first.data.search(/\S/u))
    range.setEnd(last, last.data.trimEnd().length)
    const name = drawnNow()
    range.selectNodeContents(session)
    const start = drawnNow()
    range.selectNodeContents(when)
    const time = drawnNow()
    const kinds = [
      ...name.map((rect) => ({ rect, kind: 'name' })),
      ...start.map((rect) => ({ rect, kind: 'start' })),
      ...time.map((rect) => ({ rect, kind: 'time' })),
    ].sort((one, other) => one.rect.top - other.rect.top)
    let line = -1
    let middle = Number.NEGATIVE_INFINITY
    const placed = kinds.map(({ rect, kind }) => {
      if (rect.top > middle) {
        line += 1
        middle = (rect.top + rect.bottom) / 2
      }
      return { kind, line, left: rect.left, right: rect.right, width: rect.width }
    })
    const of = (kind: string) => placed.filter((rect) => rect.kind === kind)
    const lastLine = Math.max(...of('name').map((rect) => rect.line))
    const onLast = of('name').filter((rect) => rect.line === lastLine)
    // The name's last piece no line may break inside, after its last space or hyphen, and the
    // no-break space after it, laid out on one line of their own in the name's font, apart from
    // the head: the name's last line as laid out is the whole name once the line breaks between
    // the name and the start, and would excuse that break.
    const piece =
      texts
        .map((text) => text.data)
        .join('')
        .trim()
        .match(/[^\s-]+-?/gu)
        ?.at(-1) ?? ''
    const probe = document.createElement('span')
    probe.textContent = `${piece}\u{A0}`
    probe.style.cssText = 'position: absolute; visibility: hidden; white-space: pre'
    who.append(probe)
    const pieceWidth = probe.getBoundingClientRect().width
    probe.remove()
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('No canvas')
    const style = getComputedStyle(who)
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const sum = (kind: string) => of(kind).reduce((total, rect) => total + rect.width, 0)
    // The start is one token that never wraps: its width is how far it is drawn. A range over a
    // start that is a link returns the link's box beside its text, so a sum counts it twice.
    const startLeft = Math.min(...of('start').map(({ left }) => left))
    const startRight = Math.max(...of('start').map(({ right }) => right))
    const startWidth = startRight - startLeft
    const box = root.getBoundingClientRect()
    return {
      // The name's left edge: where its first line starts.
      nameLeft: Math.min(
        ...of('name')
          .filter((rect) => rect.line === 0)
          .map(({ left }) => left),
      ),
      nameLastLine: lastLine,
      nameRight: Math.max(...onLast.map(({ right }) => right)),
      piece,
      pieceWidth,
      startWidth,
      space: canvas.measureText(' ').width,
      startLines: [...new Set(of('start').map((rect) => rect.line))],
      startLeft,
      startRight,
      timeLines: [...new Set(of('time').map((rect) => rect.line))],
      timeLeft: Math.min(...of('time').map(({ left }) => left)),
      // The pair and the date end to end, with the line's gap between them, against the line.
      together: sum('name') + canvas.measureText(' ').width + startWidth + sum('time'),
      gap: Number.parseFloat(getComputedStyle(root).columnGap) || 0,
      width: box.width,
    }
  })
  const label = `${where}: line ${drawn.nameLastLine} of the name`
  expect.soft(drawn.startLines, `${where}: the session's start on one line`).toHaveLength(1)
  expect.soft(drawn.timeLines, `${where}: the date on one line`).toHaveLength(1)
  const [startLine] = drawn.startLines
  const [timeLine] = drawn.timeLines
  const start: StartPlace = startLine === drawn.nameLastLine ? 'after the name' : 'own line'
  if (start === 'after the name')
    expect
      .soft(
        Math.abs(drawn.startLeft - drawn.nameRight - drawn.space),
        `${label}: the start right after the name, a space apart`,
      )
      .toBeLessThanOrEqual(1)
  else {
    // Only a start that cannot follow the name's last line in the head's column stands under it.
    expect
      .soft(startLine, `${label}: the start on the line after the name's`)
      .toBe(drawn.nameLastLine + 1)
    expect
      .soft(
        drawn.pieceWidth + drawn.startWidth,
        `${label}: the start alone though «${drawn.piece}» and it fit the column of ${drawn.width}px`,
      )
      .toBeGreaterThan(drawn.width - 0.5)
    expect
      .soft(Math.abs(drawn.startLeft - drawn.nameLeft), `${label}: the start under the name`)
      .toBeLessThanOrEqual(1)
  }
  if (timeLine === startLine) {
    expect
      .soft(drawn.timeLeft, `${where}: the date after the start`)
      .toBeGreaterThan(drawn.startRight)
    return { date: 'its line', start }
  }
  expect.soft(timeLine, `${where}: the date on its own line under the pair`).toBe(startLine + 1)
  expect
    .soft(
      Math.abs(drawn.timeLeft - drawn.nameLeft),
      `${where}: the date starts where the name does`,
    )
    .toBeLessThanOrEqual(1)
  // Under the pair only where the pair and the date do not fit one line.
  expect
    .soft(drawn.together + drawn.gap, `${where}: the date left a line it fits beside the pair`)
    .toBeGreaterThan(drawn.width - 1)
  return { date: 'own line', start }
}
