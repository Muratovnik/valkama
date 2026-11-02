/**
 * What the editor's toolbar does to the text, as plain text: nothing here knows
 * there is a field.
 *
 * An edit names the range it replaces, not the whole new text, so the field can
 * hand it to the browser as one typed change and Ctrl+Z takes it back. The marks
 * go around the words rather than the selection: a double click on Windows takes
 * the space after a word too, and `**word **` is not emphasis, it is asterisks.
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

/** The selection without the white space at its ends, which marks must stay outside of. */
function wordsOf(value: string, start: number, end: number) {
  const selected = value.slice(start, end)
  const from = start + selected.length - selected.trimStart().length
  const to = Math.max(from, end - (selected.length - selected.trimEnd().length))
  // Only white space selected: the marks go at its end, as they would at a caret.
  return from === to ? { from: end, to: end } : { from, to }
}

/**
 * These words without the mark around them, or null when they do not carry it. A code
 * span counts by whichever fence it has, because the fence a press would write depends
 * on the very backticks it is looking at.
 */
function withoutMark(words: string, mark: string) {
  const char = mark.charAt(0)
  const left = runLength(words, char, false)
  const right = runLength(words, char, true)
  if (left + right >= words.length) return null
  if (char === '`') return left > 0 && left === right ? words.slice(left, -left) : null
  return runsMake(mark, left, right) ? words.slice(mark.length, -mark.length) : null
}

/** A line with its words changed and the white space around them left outside the marks. */
function onWords(line: string, change: (words: string) => string) {
  const from = line.length - line.trimStart().length
  const to = line.trimEnd().length
  return from < to ? `${line.slice(0, from)}${change(line.slice(from, to))}${line.slice(to)}` : line
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
    .filter((line) => line.trim())
    .every((line) => withoutMark(line.trim(), mark) !== null)
  const bare = (words: string) => withoutMark(words, mark) ?? words
  const marked = (words: string) =>
    withoutMark(words, mark) === null ? `${mark}${words}${mark}` : words
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
  if (words.includes('\n')) return wrapLines(value, from, to, mark)
  if (standsInside(before, after, mark)) {
    return {
      start: from - mark.length,
      end: to + mark.length,
      text: words,
      selection: [from - mark.length, to - mark.length],
    }
  }
  return {
    start: from,
    end: to,
    text: `${mark}${words}${mark}`,
    selection: [from + mark.length, to + mark.length],
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
