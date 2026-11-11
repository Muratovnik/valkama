/**
 * The row headings of a table as a screen reader meets them. A row heading's name is computed from
 * its content, as the accessible-name computation does for a cell: an element's `aria-label`
 * stands for all it holds, hidden content counts for nothing, and text counts as it reads. That
 * name is announced before every cell of the row. A control inside it is read on its own, with
 * its name and its description, which these tables give as `aria-description`.
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

const spaced = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** The name an element gives from its content, the subset of the computation these tables use. */
function fromContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return ''
  const label = node.getAttribute('aria-label')?.trim()
  return label || [...node.childNodes].map((child) => fromContent(child)).join('')
}

/** One row heading: its name, and the control in it — a link or a button — if there is one. */
export interface RowHeading {
  control: { description: string; name: string; role: 'button' | 'link' } | null
  name: string
}

function rowHeading(cell: DOMWrapper<Element>): RowHeading {
  const control = cell.element.querySelector('a[href], button')
  return {
    name: spaced(fromContent(cell.element)),
    control: control && {
      role: control.tagName === 'A' ? 'link' : 'button',
      name: spaced(fromContent(control)),
      description: spaced(control.getAttribute('aria-description') ?? ''),
    },
  }
}

/** Every row heading of the table's body, in order. */
export const rowHeadings = (wrapper: VueWrapper | DOMWrapper<Element>) =>
  wrapper.findAll('tbody th[scope="row"]').map((cell) => rowHeading(cell))
