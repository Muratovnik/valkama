/**
 * Where the line the caret stands on in a text area is drawn in the window. The platform has no
 * call for it: a range cannot reach inside a text area, so the field's text up to the caret is
 * laid out again, out of sight, in a box that wraps it as the field does, and the line a mark
 * put at the caret falls on is read off that copy.
 */

/** What decides where the field's text breaks and how tall each of its lines is. */
const LAYOUT = [
  'direction',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'hyphens',
  'letter-spacing',
  'line-height',
  'overflow-wrap',
  'tab-size',
  'text-indent',
  'text-rendering',
  'text-transform',
  'white-space',
  'word-break',
  'word-spacing',
] as const

const pixels = (value: string) => Number.parseFloat(value) || 0

/** The caret's line in `field`, top and bottom in the window, as it is drawn now. */
export function caretLine(field: HTMLTextAreaElement): { bottom: number; top: number } {
  const style = getComputedStyle(field)
  const copy = document.createElement('div')
  for (const name of LAYOUT) copy.style.setProperty(name, style.getPropertyValue(name))
  // The width the field's own text wraps at: inside its padding and clear of its scrollbar.
  const wraps = field.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight)
  Object.assign(copy.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    boxSizing: 'content-box',
    width: `${String(wraps)}px`,
    padding: '0',
    border: '0',
    margin: '0',
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
  })
  const at = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd
  copy.textContent = field.value.slice(0, at)
  const mark = document.createElement('span')
  // What follows the caret, so the mark breaks where the text breaks; a letter where none does.
  mark.textContent = field.value.slice(at) || '.'
  copy.append(mark)
  document.body.append(copy)
  const from = copy.getBoundingClientRect().top
  const first = mark.getClientRects()[0] ?? mark.getBoundingClientRect()
  const height = pixels(style.lineHeight) || first.height
  // The mark's box is its letters' height, inside the line's: the line it falls on, whole.
  const line = Math.max(0, Math.floor((first.top - from + first.height / 2) / height))
  copy.remove()
  const top =
    field.getBoundingClientRect().top +
    field.clientTop +
    pixels(style.paddingTop) +
    line * height -
    field.scrollTop
  return { top, bottom: top + height }
}
