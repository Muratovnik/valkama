/**
 * A source as its reader runs it: every comment taken out, and nothing else.
 *
 * Which marks open a comment depends on the language a stretch of the file is in, so the file
 * is read in its parts: a stylesheet (a `.css` file, a `<style>` block) has only `/* … *\/`, a
 * script (a `.ts` file, a `<script>` block) has that and `// …`, and markup has `<!-- … -->`.
 * A `//` is a comment only in a script: in a stylesheet or in markup it starts a URL
 * (`url(//x.png)`, `href="//x"`). Text in quotes opens no comment, so `'**\/*.vue'` and
 * `content: "//x"` stay whole; a template literal's `${…}` is script again, and a regular
 * expression is read to its closing `/`.
 *
 * A rule that read the raw source counted a commented-out `border` as a drawn line and a
 * commented-out import as an import direction; one that stripped every kind everywhere cut a
 * declaration off after a `url(//…)`. A comment becomes one space, and a line comment keeps its
 * line break, so what stood apart stays apart and every line keeps its number.
 */

/** Characters after which a `/` starts a regular expression rather than divides. */
const BEFORE_EXPRESSION = new Set('(,=:[!&|?{};+-*%<>~^')
const KEYWORDS_BEFORE_EXPRESSION =
  /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/

/** The end of a quoted string that starts at `start`, or of its line if it is not closed. */
function quotedEnd(code, start) {
  const quote = code[start]
  let index = start + 1
  while (index < code.length && code[index] !== quote && code[index] !== '\n') {
    index += code[index] === '\\' ? 2 : 1
  }
  return Math.min(index + 1, code.length)
}

/** The end of a comment of the block kind that starts at `start`, keeping its line breaks. */
function blockComment(code, start) {
  const close = code.indexOf('*/', start + 2)
  const end = close === -1 ? code.length : close + 2
  return { end, text: ` ${code.slice(start, end).replaceAll(/[^\n]/g, '')}` }
}

/** Where a regular expression that starts at `start` ends, or `start + 1` if it is a division. */
function regexEnd(code, start) {
  let index = start + 1
  let inClass = false
  while (index < code.length && code[index] !== '\n') {
    switch (code[index]) {
      case '\\': {
        index += 1
        break
      }
      case '[': {
        inClass = true
        break
      }
      case ']': {
        inClass = false
        break
      }
      case '/': {
        if (!inClass) return flagsEnd(code, index + 1)
        break
      }
      default:
    }
    index += 1
  }
  return start + 1
}

/** Where the flags after a regular expression's closing `/` end. */
function flagsEnd(code, start) {
  let index = start
  while (/[a-z]/i.test(code[index] ?? '')) index += 1
  return index
}

const startsExpression = (kept) => {
  const before = kept.trimEnd()
  return (
    before === '' || BEFORE_EXPRESSION.has(before.at(-1)) || KEYWORDS_BEFORE_EXPRESSION.test(before)
  )
}

/** A template literal from its opening backtick: its words, and each `${…}` read as script. */
function templateLiteral(code, start) {
  let kept = '`'
  let index = start + 1
  while (index < code.length) {
    const character = code[index]
    if (character === '\\') {
      kept += code.slice(index, index + 2)
      index += 2
    } else if (character === '`') {
      return { end: index + 1, text: `${kept}\`` }
    } else if (character === '$' && code[index + 1] === '{') {
      const inner = script(code, index + 2, true)
      kept += `\${${inner.text}}`
      index = inner.end + 1
    } else {
      kept += character
      index += 1
    }
  }
  return { end: index, text: kept }
}

/** What starts at `index` that is read whole, a comment, a string or a regular expression. */
function scriptPart(code, index, kept) {
  const character = code[index]
  const next = code[index + 1]
  if (character === '/' && next === '/') {
    const end = code.indexOf('\n', index)
    return { end: end === -1 ? code.length : end, text: ' ' }
  }
  if (character === '/' && next === '*') return blockComment(code, index)
  if (character === '`') return templateLiteral(code, index)
  let end = index
  if (character === "'" || character === '"') end = quotedEnd(code, index)
  else if (character === '/' && startsExpression(kept)) end = regexEnd(code, index)
  return end === index ? null : { end, text: code.slice(index, end) }
}

/** Script from `start`, to its end or, inside `${…}`, to the brace that closes it. */
function script(code, start = 0, substitution = false) {
  let kept = ''
  let depth = 0
  let index = start
  while (index < code.length) {
    const part = scriptPart(code, index, kept)
    if (part) {
      kept += part.text
      index = part.end
      continue
    }
    const character = code[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      if (substitution && depth === 0) return { end: index, text: kept }
      depth -= 1
    }
    kept += character
    index += 1
  }
  return { end: index, text: kept }
}

/** A stylesheet without its comments: quotes and an unquoted `url(…)` keep what they hold. */
function stylesheet(code) {
  let kept = ''
  let index = 0
  while (index < code.length) {
    const character = code[index]
    let end = index + 1
    if (character === '/' && code[index + 1] === '*') {
      const comment = blockComment(code, index)
      kept += comment.text
      index = comment.end
      continue
    }
    if (character === "'" || character === '"') end = quotedEnd(code, index)
    else if (/^url\(\s*[^\s'")]/i.test(code.slice(index, index + 6))) {
      const close = code.indexOf(')', index)
      end = close === -1 ? code.length : close + 1
    }
    kept += code.slice(index, end)
    index = end
  }
  return kept
}

/** Markup without its comments, each `<script>` and `<style>` block read in its own language. */
function component(source) {
  const part = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
  return source.replaceAll(part, (whole, tag, body) => {
    if (!tag) return ` ${whole.replaceAll(/[^\n]/g, '')}`
    const open = whole.slice(0, whole.indexOf('>') + 1)
    const read = tag.toLowerCase() === 'style' ? stylesheet(body) : script(body).text
    return `${open}${read}</${tag}>`
  })
}

/** The source of `file` with every comment taken out, as the language of each of its parts says. */
export function uncommented(file, source) {
  if (file.endsWith('.vue')) return component(source)
  if (file.endsWith('.css')) return stylesheet(source)
  return script(source).text
}
