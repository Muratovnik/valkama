/**
 * What the editor's toolbar does to the text, as plain text: nothing here knows
 * there is a field.
 *
 * An edit names the range it replaces, not the whole new text, so the field can
 * hand it to the browser as one typed change and Ctrl+Z takes it back. The marks
 * go around the words rather than the selection: a double click on Windows takes
 * the space after a word too, and `**word **` is not emphasis, it is asterisks. A
 * list item's marker is not one of its words either: `**- один**` is no longer a list.
 */
export interface TextEdit {
  end: number
  /** The selection afterwards, in the finished text. */
  selection: readonly [start: number, end: number]
  start: number
  text: string
}

export type MarkdownTool = 'bold' | 'code' | 'italic' | 'link' | 'list'

const URL_ONLY = /^(?:https?:\/\/|mailto:)\S+$/iu
const LIST_MARK = /^(\s*)[-*+] /u
const LEADING_SPACE = /^\s*/u
/** A list item's marker with its task box, if it has one. */
const ITEM_MARK = /^(?:[-*+]|\d{1,9}[.)]) (?:\[[ xX]\] )?/u
/** A part of the words already carrying the mark: the mark over them all would break it. */
const MARKED_PARTS = new Map([
  ['**', /\*\*(?=\S)(.+?)(?<=\S)\*\*/gu],
  ['*', /(?<!\*)\*(?=[^\s*])([^*]*?)(?<=[^\s*])\*(?!\*)/gu],
])

/** How many times `mark` stands right at the end of `before`, or at the start of `after`. */
function runLength(text: string, mark: string, fromEnd: boolean) {
  let length = 0
  while (length < text.length) {
    const at = fromEnd ? text.length - 1 - length : length
    if (text.charAt(at) !== mark) break
    length += 1
  }
  return length
}

/**
 * Whether runs of the mark's character this long make that mark. Emphasis counts its
 * asterisks, because `**word**` holds `*` on both sides and is not italic.
 */
function runsMake(mark: string, left: number, right: number) {
  return mark === '*'
    ? left % 2 === 1 && right % 2 === 1
    : left >= mark.length && right >= mark.length
}

/** Whether the selection already stands inside this mark. */
function standsInside(before: string, after: string, mark: string) {
  const char = mark.charAt(0)
  return runsMake(mark, runLength(before, char, true), runLength(after, char, false))
}

/** A code span holds a backtick by being fenced with a longer run of them. */
function codeFence(selected: string) {
  const runs = (selected.match(/`+/gu) ?? []).map((run) => run.length)
  return '`'.repeat(Math.max(0, ...runs) + 1)
}

/** How long a list item's marker is where one begins the line at `from`. */
function itemMark(value: string, from: number, to: number) {
  const lineStart = value.slice(0, from).lastIndexOf('\n') + 1
  const mark = value.slice(lineStart, from).trim() ? null : ITEM_MARK.exec(value.slice(from, to))
  return mark?.[0].length ?? 0
}

/** The selection without what marks must stay outside of: white space, and an item's marker. */
function wordsOf(value: string, start: number, end: number) {
  const selected = value.slice(start, end)
  const from = start + selected.length - selected.trimStart().length
  const to = Math.max(from, end - (selected.length - selected.trimEnd().length))
  // Only white space selected: the marks go at its end, as they would at a caret.
  return from === to ? { from: end, to: end } : { from: from + itemMark(value, from, to), to }
}

/** Whether the mark stands again inside what it would wrap, so that it wraps only a part. */
function holdsMark(inner: string, mark: string, width: number) {
  const fenced = mark.charAt(0) === '`'
  return (inner.match(fenced ? /`+/gu : /\*+/gu) ?? []).some(({ length }) =>
    fenced ? length === width : runsMake(mark, length, length),
  )
}

/**
 * These words without the mark around them all, or null when they do not carry it: the
 * marks at the ends of `**a** и **b**` are two. A code span counts by whichever fence it
 * has, because the fence a press would write depends on the very backticks it looks at.
 */
function withoutMark(words: string, mark: string) {
  const char = mark.charAt(0)
  const left = runLength(words, char, false)
  const right = runLength(words, char, true)
  if (left + right >= words.length) return null
  const fenced = char === '`'
  if (!(fenced ? left > 0 && left === right : runsMake(mark, left, right))) return null
  const width = fenced ? left : mark.length
  const inner = words.slice(width, -width)
  return holdsMark(inner, mark, width) ? null : inner
}

/** The mark around all of these words, taking it off any part of them that had it already. */
function withMark(words: string, mark: string) {
  const parts = MARKED_PARTS.get(mark)
  return `${mark}${parts ? words.replace(parts, '$1') : words}${mark}`
}

/** Where a line's words stand, inside its white space and after an item's marker. */
function lineWords(line: string) {
  const from = line.length - line.trimStart().length
  const to = line.trimEnd().length
  return { from: from + (ITEM_MARK.exec(line.slice(from))?.[0].length ?? 0), to }
}

/** A line with its words changed and what marks stay outside of left where it is. */
function onWords(line: string, change: (words: string) => string) {
  const { from, to } = lineWords(line)
  return from < to ? `${line.slice(0, from)}${change(line.slice(from, to))}${line.slice(to)}` : line
}

/** The words of a line, empty when it has only white space or a marker. */
function wordsOfLine(line: string) {
  const { from, to } = lineWords(line)
  return line.slice(from, Math.max(from, to))
}

/** How far past a selection made by hand the marks of its first and last lines stand. */
function outerMarks(before: string, after: string, mark: string) {
  if (mark.charAt(0) !== '`') return standsInside(before, after, mark) ? mark.length : 0
  const run = runLength(before, '`', true)
  return run === runLength(after, '`', false) ? run : 0
}

/**
 * Several lines. Emphasis cannot cross a blank line, so they are marked one by one and
 * come off the same way: when every line with words carries the mark a press takes it
 * off them all, and otherwise it goes on the lines still without it. One mark around
 * them all, which a person can have typed, comes off as it does around one line.
 */
function wrapLines(value: string, from: number, to: number, mark: string): TextEdit {
  const outer = outerMarks(value.slice(0, from), value.slice(to), mark)
  const start = from - outer
  const end = to + outer
  const lines = value.slice(start, end).split('\n')
  const carried = lines
    .map((line) => wordsOfLine(line))
    .filter(Boolean)
    .every((words) => withoutMark(words, mark) !== null)
  const bare = (words: string) => withoutMark(words, mark) ?? words
  const marked = (words: string) =>
    withoutMark(words, mark) === null ? withMark(words, mark) : words
  const text =
    !carried && outer
      ? value.slice(from, to)
      : lines.map((line) => onWords(line, carried ? bare : marked)).join('\n')
  return { start, end, text, selection: [start, start + text.length] }
}

function wrap(value: string, start: number, end: number, mark: string): TextEdit {
  const { from, to } = wordsOf(value, start, end)
  const before = value.slice(0, from)
  const after = value.slice(to)
  const words = value.slice(from, to)
  // The marks selected with the words, one around them all whether that is a line or several.
  const inner = withoutMark(words, mark)
  if (inner !== null)
    return { start: from, end: to, text: inner, selection: [from, from + inner.length] }
  if (words.includes('\n')) return wrapLines(value, from, to, mark)
  if (standsInside(before, after, mark)) {
    return {
      start: from - mark.length,
      end: to + mark.length,
      text: words,
      selection: [from - mark.length, to - mark.length],
    }
  }
  const text = withMark(words, mark)
  const opening = from + mark.length
  return {
    start: from,
    end: to,
    text,
    selection: [opening, opening + text.length - 2 * mark.length],
  }
}

/** The address goes where it belongs, and the caret goes to whichever half is still empty. */
function link(value: string, start: number, end: number): TextEdit {
  const { from, to } = wordsOf(value, start, end)
  const words = value.slice(from, to)
  if (URL_ONLY.test(words)) {
    const caret = from + 1
    return { start: from, end: to, text: `[](${words})`, selection: [caret, caret] }
  }
  const caret = from + words.length + 3
  return words
    ? { start: from, end: to, text: `[${words}]()`, selection: [caret, caret] }
    : { start: from, end: to, text: '[]()', selection: [from + 1, from + 1] }
}

/** Every line the selection touches becomes a list item; lines that all are one stop being. */
function list(value: string, start: number, end: number): TextEdit {
  const lineStart = value.slice(0, start).lastIndexOf('\n') + 1
  // A selection that ends at the very start of a line has not reached that line.
  const reach = end > start && value.charAt(end - 1) === '\n' ? end - 1 : end
  const nextBreak = value.indexOf('\n', reach)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const written = lines.filter((line) => line.trim())
  const listed = written.length > 0 && written.every((line) => LIST_MARK.test(line))
  const text = lines
    .map((line) => {
      if (lines.length === 1 && !line.trim()) return `${line}- `
      if (!line.trim()) return line
      return listed ? line.replace(LIST_MARK, '$1') : line.replace(LEADING_SPACE, '$&- ')
    })
    .join('\n')
  if (end > start) {
    return {
      start: lineStart,
      end: lineEnd,
      text,
      selection: [lineStart, lineStart + text.length],
    }
  }
  const caret = Math.max(lineStart, start + text.length - (lineEnd - lineStart))
  return { start: lineStart, end: lineEnd, text, selection: [caret, caret] }
}

/** The edit one toolbar action makes to `value`, with `start`–`end` selected. */
export function markdownEdit(
  tool: MarkdownTool,
  value: string,
  start: number,
  end: number,
): TextEdit {
  if (tool === 'link') return link(value, start, end)
  if (tool === 'list') return list(value, start, end)
  if (tool === 'bold') return wrap(value, start, end, '**')
  if (tool === 'italic') return wrap(value, start, end, '*')
  const { from, to } = wordsOf(value, start, end)
  return wrap(value, start, end, codeFence(value.slice(from, to)))
}
