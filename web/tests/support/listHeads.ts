/**
 * What each heading of the mounted list says to a reader: its words, but not those of a part
 * it hides, such as the title's choice of order, which stays in the heading at every fit and
 * is shown only where the folded sorts are a choice.
 */
export function listHeads(): (string | undefined)[] {
  return [...document.querySelectorAll('thead th')].map((cell) => {
    const shown = cell.cloneNode(true) as Element
    for (const hidden of shown.querySelectorAll('[hidden]')) hidden.remove()
    return shown.textContent?.trim()
  })
}
