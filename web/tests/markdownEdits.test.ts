/**
 * The toolbar's edits as text. Each case states the whole text before, with the
 * selection written in it as `[` and `]` (`|` for a caret), and the whole text
 * after in the same notation, so the expectation reads as what a person sees.
 */
import { describe, expect, it } from 'vitest'

import { markdownEdit } from '@/shared/lib/markdownEdits.ts'
import type { MarkdownTool } from '@/shared/lib/markdownEdits.ts'

function applied(tool: MarkdownTool, marked: string) {
  const caret = marked.indexOf('|')
  const start = caret === -1 ? marked.indexOf('[') : caret
  const value = marked.replace('|', '').replace('[', '').replace(']', '')
  const end = caret === -1 ? marked.indexOf(']') - 1 : caret
  const edit = markdownEdit(tool, value, start, end)
  const text = value.slice(0, edit.start) + edit.text + value.slice(edit.end)
  const [from, to] = edit.selection
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`
}

describe('markdownEdit', () => {
  it.each<[MarkdownTool, string, string]>([
    ['bold', 'a [word] b', 'a **[word]** b'],
    ['italic', 'a [word] b', 'a *[word]* b'],
    ['code', 'a [word] b', 'a `[word]` b'],
    ['bold', 'a | b', 'a **|** b'],
    ['italic', 'a | b', 'a *|* b'],
    ['code', 'a | b', 'a `|` b'],
  ])('%s wraps the selection or opens at the caret: %s', (tool, before, after) => {
    expect(applied(tool, before)).toBe(after)
  })

  it('keeps the space a double click selected outside the marks', () => {
    expect(applied('bold', 'a [word ]b')).toBe('a **[word]** b')
    expect(applied('italic', '[ word ]b')).toBe(' *[word]* b')
  })

  it('treats a selection of nothing but space as a caret at its end', () => {
    expect(applied('bold', 'a[  ]b')).toBe('a  **|**b')
  })

  it('takes a mark off when it is pressed again, without mistaking one mark for another', () => {
    expect(applied('bold', 'a **[word]** b')).toBe('a [word] b')
    expect(applied('italic', 'a *[word]* b')).toBe('a [word] b')
    expect(applied('code', 'a `[word]` b')).toBe('a [word] b')
    expect(applied('bold', 'a **|** b')).toBe('a | b')
    // Bold and italic are made of the same character and stack rather than undo.
    expect(applied('italic', 'a **[word]** b')).toBe('a ***[word]*** b')
    expect(applied('bold', 'a *[word]* b')).toBe('a ***[word]*** b')
    expect(applied('italic', 'a ***[word]*** b')).toBe('a **[word]** b')
    expect(applied('bold', 'a ***[word]*** b')).toBe('a *[word]* b')
  })

  it('marks several lines one by one, because emphasis cannot cross a blank line', () => {
    expect(applied('bold', '[one\n\ntwo]')).toBe('[**one**\n\n**two**]')
  })

  it.each<[MarkdownTool, string, string]>([
    ['bold', '[one\ntwo]', '[**one**\n**two**]'],
    ['italic', '[one\ntwo]', '[*one*\n*two*]'],
    ['code', '[one\ntwo]', '[`one`\n`two`]'],
    ['bold', '[one\n\ntwo]', '[**one**\n\n**two**]'],
    ['code', '[a`b\nc]', '[``a`b``\n``c``]'],
  ])('%s comes off several lines as it went on: %s', (tool, before, after) => {
    expect(applied(tool, before)).toBe(after)
    expect(applied(tool, after)).toBe(before)
  })

  it('takes the marks off lines when the selection stops short of the outer two', () => {
    expect(applied('bold', '**[one**\n**two]**')).toBe('[one\ntwo]')
    expect(applied('italic', '*[one*\n*two]*')).toBe('[one\ntwo]')
    expect(applied('code', '`[one`\n`two]`')).toBe('[one\ntwo]')
  })

  it('takes off one bold that runs across a line break, as it does on one line', () => {
    expect(applied('bold', '**[one\ntwo]**')).toBe('[one\ntwo]')
  })

  it('tells one mark from another on several lines, as it does on one', () => {
    expect(applied('italic', '[**one**\n**two**]')).toBe('[***one***\n***two***]')
    expect(applied('bold', '[*one*\n*two*]')).toBe('[***one***\n***two***]')
    expect(applied('italic', '[***one***\n***two***]')).toBe('[**one**\n**two**]')
    expect(applied('bold', '[***one***\n***two***]')).toBe('[*one*\n*two*]')
  })

  it('marks only what is not marked yet, so a second press has one thing to undo', () => {
    expect(applied('bold', '[**one**\ntwo]')).toBe('[**one**\n**two**]')
  })

  it('keeps the marks against the words of an indented line', () => {
    expect(applied('bold', '[one\n  two  \nthree]')).toBe('[**one**\n  **two**  \n**three**]')
    expect(applied('bold', '[**one**\n  **two**  \n**three**]')).toBe('[one\n  two  \nthree]')
  })

  it('recognises a selection already wrapped as a whole, on one line or several', () => {
    expect(applied('bold', '[**один\nдва**]')).toBe('[один\nдва]')
    expect(applied('italic', '[*один\nдва*]')).toBe('[один\nдва]')
    expect(applied('code', '[`один\nдва`]')).toBe('[один\nдва]')
    expect(applied('bold', '[**word**]')).toBe('[word]')
    expect(applied('italic', '[***word***]')).toBe('[**word**]')
    expect(applied('bold', '[***word***]')).toBe('[*word*]')
    expect(applied('code', '[``a`b``]')).toBe('[a`b]')
  })

  it('takes two marks for two, and a mark over them all replaces them', () => {
    expect(applied('bold', '[**a** и\nб **в**]')).toBe('[**a и**\n**б в**]')
    expect(applied('bold', '[**a** и **в**]')).toBe('**[a и в]**')
    expect(applied('italic', '[*a* и *в*]')).toBe('*[a и в]*')
  })

  it.each<[MarkdownTool, string, string]>([
    ['bold', '[- один]', '- **[один]**'],
    ['italic', '[- один]', '- *[один]*'],
    ['code', '[- один]', '- `[один]`'],
    ['bold', '[* один]', '* **[один]**'],
    ['italic', '[* один]', '* *[один]*'],
    ['bold', '[1. один]', '1. **[один]**'],
    ['bold', '  [- один]', '  - **[один]**'],
  ])('%s goes inside a list item’s marker: %s', (tool, before, after) => {
    expect(applied(tool, before)).toBe(after)
  })

  it('goes inside a task’s box as it does a marker', () => {
    expect(markdownEdit('bold', '- [ ] один', 0, 10)).toMatchObject({
      start: 6,
      end: 10,
      text: '**один**',
    })
  })

  it('goes inside the marker on every line, and comes off them the same way', () => {
    expect(applied('bold', '[- один\n- два]')).toBe('- [**один**\n- **два**]')
    expect(applied('bold', '- [**один**\n- **два**]')).toBe('- [один\n- два]')
    expect(applied('bold', '[- один\n* два\n3. три]')).toBe('- [**один**\n* **два**\n3. **три**]')
  })

  it('leaves a list item a list item for the list button after a mark', () => {
    expect(applied('list', '- [**один**]')).toBe('[**один**]')
  })

  it('puts a selected list item’s words in a link, and not its marker', () => {
    expect(applied('link', '[- один]')).toBe('- [один](|)')
  })

  it('fences a code span with more backticks than the selection holds', () => {
    expect(applied('code', '[a`b]')).toBe('``[a`b]``')
  })

  it('puts a selection into a link and the caret where the address goes', () => {
    expect(applied('link', 'see [the docs] now')).toBe('see [the docs](|) now')
    expect(applied('link', 'see | now')).toBe('see [|]() now')
  })

  it('takes a selected address as the address and leaves the caret on the text', () => {
    expect(applied('link', 'at [https://example.com/a?b=1] now')).toBe(
      'at [|](https://example.com/a?b=1) now',
    )
  })

  it('makes the caret’s line a list item and moves the caret with its text', () => {
    expect(applied('list', 'one\ntw|o\nthree')).toBe('one\n- tw|o\nthree')
    expect(applied('list', 'one\n|')).toBe('one\n- |')
    expect(applied('list', '|')).toBe('- |')
    expect(applied('list', '  in|dented')).toBe('  - in|dented')
  })

  it('makes every line a selection touches a list item, and leaves blank lines blank', () => {
    expect(applied('list', 'a [b\nc\n\nd] e\nf')).toBe('[- a b\n- c\n\n- d e]\nf')
    // A selection that stops at the start of a line has not reached that line.
    expect(applied('list', '[one\n]two')).toBe('[- one]\ntwo')
  })

  it('takes the marks off when every line already is a list item', () => {
    expect(applied('list', '[- one\n* two\n  + three]')).toBe('[one\ntwo\n  three]')
    expect(applied('list', '- on|e')).toBe('on|e')
    expect(applied('list', '- |')).toBe('|')
  })
})
