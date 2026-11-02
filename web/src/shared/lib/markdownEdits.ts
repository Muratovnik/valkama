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
 * Whether the selection already stands inside this mark. Emphasis counts its
 * asterisks, because `**word**` holds `*` on both sides and is not italic.
 */
function standsInside(before: string, after: string, mark: string) {
  const left = runLength(before, mark.charAt(0), true)
  const right = runLength(after, mark.charAt(0), false)
  return mark === '*'
    ? left % 2 === 1 && right % 2 === 1
    : left >= mark.length && right >= mark.length
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

function wrap(value: string, start: number, end: number, mark: string): TextEdit {
  const { from, to } = wordsOf(value, start, end)
  const before = value.slice(0, from)
  const after = value.slice(to)
  const words = value.slice(from, to)
  if (standsInside(before, after, mark) && !words.includes('\n')) {
    return {
      start: from - mark.length,
      end: to + mark.length,
      text: words,
      selection: [from - mark.length, to - mark.length],
    }
  }
  // Emphasis cannot cross a blank line, so several lines are marked one by one.
  if (words.includes('\n')) {
    const text = words
      .split('\n')
      .map((line) => (line.trim() ? `${mark}${line}${mark}` : line))
      .join('\n')
    return { start: from, end: to, text, selection: [from, from + text.length] }
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
