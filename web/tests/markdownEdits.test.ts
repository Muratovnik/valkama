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
