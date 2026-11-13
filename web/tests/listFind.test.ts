/**
 * The list's own find, apart from the page: what a term matches in a row's
 * words, where each folded character came from, the order of the matches, the
 * steps between them, and which one stays current while the list changes.
 */
import { describe, expect, it } from 'vitest'

import {
  firstFrom,
  fold,
  keptMatch,
  listMatches,
  occurrences,
  RUN_BREAK,
  stepMatch,
  termOf,
} from '@/widgets/work-item-views/utils/listFind.ts'

/** How many times what the reader types is found in a row's words. */
const found = (words: string, typed: string) => occurrences(fold(words).text, termOf(typed)).length

describe('a term in the words of a row', () => {
  it('is found whatever the case of either', () => {
    expect(found('Fix the Login PAGE', 'login page')).toBe(1)
    expect(found('Сломан ВХОД', 'вход')).toBe(1)
    expect(found('сломан вход', 'ВХОД')).toBe(1)
  })

  it('reads «ё» as «е», typed or written', () => {
    expect(found('Всё ещё', 'все еще')).toBe(1)
    expect(found('Все еще', 'всё ещё')).toBe(1)
    expect(found('Всё', 'всё')).toBe(1)
  })

  it('reads a Latin letter without its marks, composed or written apart', () => {
    expect(found('Café crème', 'cafe creme')).toBe(1)
    expect(found('Café', 'café')).toBe(1)
    expect(found('café', 'café')).toBe(1)
    expect(found('NAÏVE', 'naive')).toBe(1)
  })

  it('does not count a stress written over a Cyrillic vowel', () => {
    expect(found('Заме́тка', 'заметка')).toBe(1)
    expect(found('заметка', 'заме́тка')).toBe(1)
  })

  it('keeps a Cyrillic letter its mark makes apart from the letter without it', () => {
    expect(found('мой', 'мои')).toBe(0)
    expect(found('мои', 'мой')).toBe(0)
    expect(found('ї', 'і')).toBe(0)
    // The letter written apart from its mark is the letter written whole.
    expect(found('мой', 'мой')).toBe(1)
  })

  it('reads a run of white space as one space, and none at the edges of a run', () => {
    expect(found('two   words\n\there', 'two words here')).toBe(1)
    expect(found('two words', 'two   words')).toBe(1)
    expect(termOf('  padded  ')).toBe('padded')
  })

  it('never spans two runs of words', () => {
    const row = ['MAIN-1', 'Backlog'].join(RUN_BREAK)
    expect(found(row, 'main-1 backlog')).toBe(0)
    expect(found(row, 'main-1')).toBe(1)
    expect(found(row, 'backlog')).toBe(1)
    // What is typed is one run, whatever it holds.
    expect(termOf(`a${RUN_BREAK}b`)).toBe('a b')
  })

  it('is found again only after the end of the last match', () => {
    expect(occurrences('aaaa', 'aa')).toEqual([0, 2])
    expect(occurrences('abab ab', 'ab')).toEqual([0, 2, 5])
  })

  it('matches nothing when nothing is typed', () => {
    expect(termOf('   ')).toBe('')
    expect(occurrences('anything', '')).toEqual([])
  })
})

describe('a folded text', () => {
  it('says where in the source each of its characters came from', () => {
    // «É», two spaces that are one, «x»: the space stands where the first space was.
    expect(fold('É  x')).toEqual({ ends: [1, 2, 4], starts: [0, 1, 3], text: 'e x' })
  })

  it('maps a letter written apart from its mark to both, so a mark covers the whole letter', () => {
    expect(fold('éb')).toEqual({ ends: [2, 3], starts: [0, 2], text: 'eb' })
  })

  it('keeps a letter outside the BMP whole', () => {
    expect(fold('a😀b')).toEqual({ ends: [1, 3, 3, 4], starts: [0, 1, 1, 3], text: 'a😀b' })
  })
})

/** Three rows: two matches in the first, none in the second, one in the third. */
const rows = [
  { id: 'a', text: 'x and x' },
  { id: 'b', text: 'none' },
  { id: 'c', text: 'x' },
]

describe('the matches of a list', () => {
  it('stand in the list’s order, row by row and in a row as its words read', () => {
    expect(listMatches(rows, 'x')).toEqual([
      { id: 'a', nth: 0, place: 0 },
      { id: 'a', nth: 1, place: 0 },
      { id: 'c', nth: 0, place: 2 },
    ])
    expect(listMatches(rows, '')).toEqual([])
    expect(listMatches(rows, 'zzz')).toEqual([])
  })

  it('are walked round past either end', () => {
    expect(stepMatch(3, 0, 1)).toBe(1)
    expect(stepMatch(3, 2, 1)).toBe(0)
    expect(stepMatch(3, 0, -1)).toBe(2)
    // With none current, the first step forward is the first and back the last.
    expect(stepMatch(3, -1, 1)).toBe(0)
    expect(stepMatch(3, -1, -1)).toBe(2)
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })

  it('start from a place in the list, round to the first past the last', () => {
    const matches = listMatches(rows, 'x')
    expect(firstFrom(matches, 0)).toBe(0)
    expect(firstFrom(matches, 1)).toBe(2)
    expect(firstFrom(matches, 3)).toBe(0)
    expect(firstFrom([], 0)).toBe(-1)
  })
})

describe('the current match as the list changes', () => {
  const matches = listMatches(rows, 'x')

  it('stays on its row and its order in the row while the row still holds it', () => {
    expect(keptMatch(matches, { id: 'a', nth: 1 }, 0)).toBe(1)
    // The row moved to the end of the list: the match goes with it.
    const moved = listMatches([rows[2], rows[1], rows[0]], 'x')
    expect(moved[keptMatch(moved, { id: 'a', nth: 1 }, 2)]).toEqual({ id: 'a', nth: 1, place: 2 })
  })

  it('stays on its row at the row’s last match when the row holds fewer', () => {
    const fewer = listMatches([{ id: 'a', text: 'x only' }, rows[1], rows[2]], 'x')
    expect(fewer[keptMatch(fewer, { id: 'a', nth: 1 }, 0)]).toEqual({ id: 'a', nth: 0, place: 0 })
  })

  it('goes on from where its row stood once the row no longer matches', () => {
    const gone = listMatches([{ id: 'a', text: 'none' }, rows[1], rows[2]], 'x')
    expect(gone[keptMatch(gone, { id: 'a', nth: 0 }, 0)]).toEqual({ id: 'c', nth: 0, place: 2 })
    expect(keptMatch([], { id: 'a', nth: 0 }, 0)).toBe(-1)
  })

  it('is the first at or after a place when there was none', () => {
    expect(keptMatch(matches, null, 1)).toBe(2)
  })
})
